import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createScheduleService, normalizeEvent} from '../service.mjs';
import {fakeFirestore} from './fake-firestore.mjs';

const BASE = Date.parse('2026-09-28T09:00:00+09:00');
const event = (changes = {}) => ({id: 'schedule-0000000001', title: '진료 예약', note: '접수 확인', startAt: BASE + 3600000, endAt: BASE + 7200000, timeZone: 'Asia/Seoul', reminderChoice: '10', ...changes});
const token = 'browser-device-token-0000000001';
const request = (data, uid = 'owner-a') => ({auth: {uid, token: {firebase: {sign_in_provider: 'google.com'}}}, data});
function setup(send = null) {
    const db = fakeFirestore(), sent = []; let clock = BASE;
    const messaging = {async sendEachForMulticast(message) { sent.push(message); return send ? send(message) : {responses: message.tokens.map(() => ({success: true}))}; }};
    const service = createScheduleService({db, messaging, now: () => clock});
    const save = (value = event(), revision = 0, requestId = 'request-0000000001', uid = 'owner-a') => service.api(request({action: 'save', event: value, expectedRevision: revision, requestId, pushToken: token}, uid));
    return {db, sent, ...service, save, at: value => { clock = value; }};
}

test('validates title, range, time zone and reminder values on the server', () => {
    assert.equal(normalizeEvent(event()).reminderAt, BASE + 3000000);
    assert.equal(normalizeEvent(event({reminderChoice: 'none'})).reminderAt, null);
    for (const patch of [{title: ' '}, {endAt: BASE}, {timeZone: 'fake/zone'}, {reminderChoice: 'NaN'}, {reminderChoice: 'custom', reminderAt: BASE + 3700000}, {id: '../another-user'}]) {
        assert.throws(() => normalizeEvent(event(patch)), {code: 'invalid-argument'});
    }
});
test('rejects unauthenticated/anonymous calls and never trusts a client uid', async () => {
    const app = setup();
    await assert.rejects(app.api({data: {action: 'get'}}), {code: 'unauthenticated'});
    await assert.rejects(app.api({auth: {uid: 'anon', token: {firebase: {sign_in_provider: 'anonymous'}}}, data: {}}), {code: 'permission-denied'});
    await app.save();
    await assert.rejects(app.api(request({action: 'get', id: event().id, uid: 'owner-a'}, 'owner-b')), {code: 'not-found'});
    const listed = await app.api(request({action: 'list', from: BASE, to: BASE + 86400000, uid: 'owner-a'}, 'owner-b'));
    assert.deepEqual(listed.events, []);
});
test('save retry is idempotent and stale updates cannot overwrite a changed event', async () => {
    const app = setup();
    const first = await app.save(); const again = await app.save();
    assert.equal(first.event.revision, 1); assert.deepEqual(again, first);
    await app.save(event({title: '변경'}), 1, 'request-0000000002');
    await assert.rejects(app.save(event(), 1, 'request-0000000003'), {code: 'aborted'});
    assert.equal([...app.db.data.keys()].filter(key => key.startsWith('daily_schedule_queue/')).length, 1);
});
test('no-reminder events require no device and a past reminder does not create an event', async () => {
    const app = setup();
    const result = await app.api(request({action: 'save', event: event({reminderChoice: 'none'}), expectedRevision: 0, requestId: 'request-0000000001'}));
    assert.equal(result.event.reminderStatus, 'none');
    assert.equal(app.db.data.size, 1);
    await assert.rejects(app.save(event({id: 'schedule-0000000002', reminderChoice: 'custom', reminderAt: BASE - 1000})), {code: 'invalid-argument'});
    await assert.rejects(app.api(request({action: 'save', event: event({id: 'schedule-0000000003'}), expectedRevision: 0, requestId: 'request-0000000002'})), {code: 'failed-precondition'});
});
test('overlapping multi-day events are listed; end exactly at midnight does not include next day', async () => {
    const app = setup();
    const midnight = Date.parse('2026-09-29T00:00:00+09:00');
    await app.save(event({startAt: BASE, endAt: midnight + 3600000, reminderChoice: 'none'}));
    await app.save(event({id: 'schedule-0000000002', endAt: midnight, reminderChoice: 'none'}));
    const list = await app.api(request({action: 'list', from: midnight, to: midnight + 86400000}));
    assert.deepEqual(list.events.map(item => item.id), [event().id]);
});
test('pagination returns a cursor even when a scan page has no overlapping events', async () => {
    const app = setup();
    for (let i = 0; i < 51; i++) await app.save(event({id: `schedule-${String(i).padStart(10, '0')}`, reminderChoice: 'none'}));
    const first = await app.api(request({action: 'list', from: BASE + 86400000, to: BASE + 2 * 86400000}));
    assert.equal(first.events.length, 0); assert.ok(first.nextCursor);
    const second = await app.api(request({action: 'list', from: BASE + 86400000, to: BASE + 2 * 86400000, cursor: first.nextCursor}));
    assert.equal(second.nextCursor, null);
});
test('listAll includes past and future dates across every page, including tied start times', async () => {
    const app = setup();
    for (let i = 0; i < 123; i++) {
        const startAt = BASE + (Math.floor(i / 3) - 20) * 86400000;
        await app.save(event({id: `schedule-${String(i).padStart(10, '0')}`, startAt, endAt: startAt + 3600000, reminderChoice: 'none'}));
    }
    const events = []; let cursor = null, pages = 0;
    do {
        const result = await app.api(request({action: 'listAll', cursor}));
        assert.ok(result.events.length <= 50);
        events.push(...result.events); cursor = result.nextCursor; pages++;
        assert.ok(pages <= 3);
    } while (cursor);
    assert.equal(pages, 3); assert.equal(events.length, 123);
    assert.equal(new Set(events.map(item => item.id)).size, 123);
    assert.ok(events[0].startAt > BASE); assert.ok(events.at(-1).startAt < BASE);
    assert.ok(events.every(item => !('lastRequestId' in item)));
});
test('listAll uses only the authenticated account and rejects foreign or deleted cursors', async () => {
    const app = setup(); await app.save();
    assert.deepEqual((await app.api(request({action: 'listAll', uid: 'owner-a'}, 'owner-b'))).events, []);
    await assert.rejects(app.api(request({action: 'listAll', cursor: event().id}, 'owner-b')), {code: 'aborted'});
    await assert.rejects(app.api(request({action: 'listAll', cursor: '../bad-cursor'})), {code: 'invalid-argument'});
    await app.api(request({action: 'delete', id: event().id, expectedRevision: 1}));
    await assert.rejects(app.api(request({action: 'listAll', cursor: event().id})), {code: 'aborted'});
});
test('rescheduling cancels the old reminder; deleting cancels pending delivery', async () => {
    const app = setup(); await app.save();
    await app.save(event({reminderChoice: '0'}), 1, 'request-0000000002');
    app.at(BASE + 3000000); await app.dispatch(); assert.equal(app.sent.length, 0);
    await app.api(request({action: 'delete', id: event().id, expectedRevision: 2}));
    app.at(BASE + 3600000); await app.dispatch(); assert.equal(app.sent.length, 0);
    assert.deepEqual(await app.api(request({action: 'delete', id: event().id, expectedRevision: 2})), {deleted: true});
});
test('overlapping scheduler invocations send only once and keep a data-only deep link', async () => {
    const app = setup(); await app.save(); app.at(BASE + 3000000);
    await Promise.all([app.dispatch(), app.dispatch()]); await app.dispatch();
    assert.equal(app.sent.length, 1); assert.equal(app.sent[0].notification, undefined);
    assert.equal(app.sent[0].data.url, `https://www.alcoholaway.com/?schedule=${event().id}`);
    const saved = await app.api(request({action: 'get', id: event().id})); assert.equal(saved.event.reminderStatus, 'sent');
});
test('editing a sent reminder preserves delivery state instead of resending it', async () => {
    const app = setup(); await app.save(); app.at(BASE + 3000000); await app.dispatch();
    await app.save(event({title: '제목 수정'}), 1, 'request-0000000002'); await app.dispatch();
    assert.equal(app.sent.length, 1);
});
test('an event cannot be deleted while its notification is in flight', async () => {
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const app = setup(async message => { entered(); await new Promise(resolve => { release = resolve; }); return {responses: message.tokens.map(() => ({success: true}))}; });
    await app.save(); app.at(BASE + 3000000); const sending = app.dispatch(); await waiting;
    await assert.rejects(app.api(request({action: 'delete', id: event().id, expectedRevision: 1})), {code: 'aborted'});
    release(); await sending;
});
test('transient partial failures retry only the devices that did not receive the push', async () => {
    let attempt = 0;
    const app = setup(message => ({responses: message.tokens.map((_, i) => ++attempt === 1 ? {success: false, error: {code: 'messaging/server-unavailable'}} : {success: true})}));
    await app.save(); await app.api(request({action: 'registerDevice', pushToken: 'browser-device-token-0000000002'}));
    app.at(BASE + 3000000); await app.dispatch();
    app.at(BASE + 3060000); await app.dispatch();
    assert.equal(app.sent.length, 2); assert.equal(app.sent[0].tokens.length, 2); assert.equal(app.sent[1].tokens.length, 1);
    assert.equal((await app.api(request({action: 'get', id: event().id}))).event.reminderStatus, 'sent');
});
test('an expired token is removed and an expired event is never sent', async () => {
    const app = setup(message => ({responses: message.tokens.map(() => ({success: false, error: {code: 'messaging/registration-token-not-registered'}}))}));
    await app.save(); app.at(BASE + 3000000); await app.dispatch();
    assert.equal([...app.db.data.keys()].filter(key => key.startsWith('daily_schedule_devices/')).length, 0);
    assert.equal((await app.api(request({action: 'get', id: event().id}))).event.reminderStatus, 'failed');
    const expired = setup(); await expired.save(); expired.at(BASE + 7200000); await expired.dispatch();
    assert.equal(expired.sent.length, 0); assert.equal((await expired.api(request({action: 'get', id: event().id}))).event.reminderStatus, 'missed');
});
test('the same device token is reassigned when a different account registers it', async () => {
    const app = setup(); await app.save();
    await app.api(request({action: 'registerDevice', pushToken: token}, 'owner-b'));
    app.at(BASE + 3000000); await app.dispatch(); assert.equal(app.sent.length, 0);
});
