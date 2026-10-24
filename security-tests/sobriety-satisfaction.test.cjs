const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {JSDOM} = require('jsdom');
const modulePromise = import(pathToFileURL(path.resolve(__dirname, '../sobriety-satisfaction.js')));
const tick = () => new Promise(resolve => setImmediate(resolve));
const at = Date.parse('2026-10-24T10:30:00+09:00');

async function fixture(t, options = {}) {
    const dom = new JSDOM('<!doctype html><body><div id="first"></div><div id="second"></div></body>', {url:'https://offline.invalid/', pretendToBeVisual:true});
    const w = dom.window, doc = w.document;
    w.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
    let owner = 'owner-a', clock = at, id = 0, loads = 0;
    const saved = [], rows = [];
    const {installSobrietySatisfaction} = await modulePromise;
    const ui = installSobrietySatisfaction({doc, win:w, getUid:() => owner, now:() => clock, newId:() => `entry-${++id}`,
        saveEntry:async (uid, entry) => { saved.push({uid, entry}); if (options.save) await options.save(uid, entry); rows.push(entry); },
        loadEntries:async uid => { loads++; return options.load ? options.load(uid) : rows.slice(); }});
    ui.bindAccount(owner); ui.mount(doc.getElementById('first'));
    await tick();
    t.after(() => { ui.destroy(); w.close(); });
    const choose = value => {
        const input = doc.querySelector(`.satisfaction-stars input[value="${value}"]`);
        input.checked = true; input.dispatchEvent(new w.Event('change', {bubbles:true}));
    };
    const submit = () => doc.querySelector('.sobriety-satisfaction').dispatchEvent(new w.Event('submit', {bubbles:true, cancelable:true}));
    return {ui, doc, w, saved, rows, choose, submit, loads:() => loads,
        owner(value) { owner = value; ui.bindAccount(value); }, clock(value) { clock = value; }};
}

test('satisfaction data retains separate same-day records, validates scores and deduplicates retries by ID', async () => {
    const {normalizeSatisfactionEntries, entriesFromDailyLogs, satisfactionKoreaDay} = await modulePromise;
    const a = {id:'a', score:2, recordedAt:at}, b = {id:'b', score:5, recordedAt:at + 1000};
    const bad = [{id:'bad', score:0, recordedAt:at}, {id:'bad2', score:5.1, recordedAt:at}, {id:'bad3', score:4, recordedAt:Infinity}, {id:'bad4', score:4, recordedAt:1e18}];
    assert.deepEqual(normalizeSatisfactionEntries([b, a, a, ...bad]).map(row => [row.id, row.score]), [['a',2], ['b',5]]);
    assert.equal(satisfactionKoreaDay(Date.parse('2026-10-23T15:00:00Z')), '2026-10-24');
    assert.deepEqual(entriesFromDailyLogs({'2026-10-24':{alcohol:3, sobrietySatisfaction:[a,b]}, '2026-10-23':{weight:60}}).map(row => row.id), ['a','b']);
});

test('7/30/90 day filters include Korean calendar-day boundaries and preserve multiple exact-time records', async () => {
    const {filterSatisfactionEntries} = await modulePromise;
    for (const period of [7,30,90]) {
        const start = Date.parse('2026-10-24T00:00:00+09:00') - (period - 1) * 86400000;
        const rows = [start - 1, start, at, at + 1].map((recordedAt,index) => ({id:String(index), score:3, recordedAt}));
        assert.deepEqual(filterSatisfactionEntries(rows, String(period), at).map(row => row.id), ['1','2']);
        assert.deepEqual(filterSatisfactionEntries(rows, 'all', at).map(row => row.id), ['0','1','2']);
    }
});

test('mount is lazy, five stars start empty, and clock rerenders preserve an unfinished rating', async t => {
    const f = await fixture(t);
    assert.equal(f.loads(), 0);
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input').length, 5);
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input:checked').length, 0);
    assert.equal(f.doc.querySelector('.satisfaction-save').disabled, true);
    f.choose(4);
    const form = f.doc.querySelector('form');
    f.ui.mount(f.doc.getElementById('second'));
    assert.equal(f.doc.querySelector('form'), form);
    assert.equal(f.doc.querySelector('.satisfaction-stars input:checked').value, '4');
    assert.equal(f.doc.querySelectorAll('.satisfaction-star.is-filled').length, 4);
    assert.equal(f.loads(), 0);
    f.ui.resetDraft();
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input:checked').length, 0);
});

test('separate saves append records, reset selection, and show history without an invented zero baseline', async t => {
    const f = await fixture(t);
    f.choose(5); f.submit(); await tick();
    assert.equal(f.saved.length, 1);
    assert.deepEqual(f.saved[0], {uid:'owner-a', entry:{id:'entry-1', score:5, recordedAt:at, day:'2026-10-24'}});
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input:checked').length, 0);
    assert.match(f.doc.querySelector('.satisfaction-status').textContent, /5点|5점/);
    f.ui.openHistory(); await tick();
    assert.equal(f.doc.querySelectorAll('.satisfaction-chart-point').length, 1);
    assert.equal(f.doc.querySelector('.satisfaction-chart-line'), null);
    assert.equal(f.doc.querySelector('.satisfaction-chart-point').getAttribute('cy'), '20');
    f.doc.querySelector('.satisfaction-close').click();
    f.clock(at + 1000); f.choose(2); f.submit(); await tick();
    f.ui.openHistory(); await tick();
    assert.equal(f.saved.length, 2);
    assert.notEqual(f.saved[0].entry.id, f.saved[1].entry.id);
    assert.equal(f.doc.querySelectorAll('.satisfaction-chart-point').length, 2);
    assert.equal(f.doc.querySelector('.satisfaction-chart-line').getAttribute('points').split(' ').length, 2);
    assert.match(f.doc.querySelector('.satisfaction-chart-summary').textContent, /3.50 \/ 5/);
    assert.equal(f.doc.querySelectorAll('.satisfaction-history-table tbody tr').length, 2);
});

test('in-flight double submits and remounts never add a second save; failed retry reuses identical ID and time', async t => {
    let release, calls = 0;
    const f = await fixture(t, {save:async () => { calls++; if (calls === 1) await new Promise((resolve, reject) => { release = reject; }); }});
    f.choose(3); f.submit(); f.submit();
    f.ui.mount(f.doc.getElementById('second')); f.ui.resetDraft();
    assert.equal(f.saved.length, 1);
    assert.equal(f.doc.querySelector('.satisfaction-save').disabled, true);
    assert.equal(f.doc.querySelector('.satisfaction-stars').disabled, true);
    release(new Error('offline')); await tick();
    assert.match(f.doc.querySelector('.satisfaction-status').textContent, /저장하지 못/);
    assert.equal(f.doc.querySelector('.satisfaction-stars input:checked').value, '3');
    f.clock(at + 86400000); f.submit(); await tick();
    assert.equal(f.saved.length, 2);
    assert.deepEqual(f.saved[0].entry, f.saved[1].entry);
    assert.equal(f.rows.length, 1);
});

test('changing the selected value after a failed attempt starts a new record', async t => {
    let calls = 0;
    const f = await fixture(t, {save:async () => { if (++calls === 1) throw new Error('offline'); }});
    f.choose(1); f.submit(); await tick();
    f.choose(4); f.clock(at + 1000); f.submit(); await tick();
    assert.notEqual(f.saved[0].entry.id, f.saved[1].entry.id);
    assert.equal(f.saved[1].entry.score, 4);
    assert.equal(f.saved[1].entry.recordedAt, at + 1000);
});

test('account change clears drafts, closes the graph and ignores another account\'s late history or save result', async t => {
    let resolveSave, resolveLoad, loadCount = 0;
    const f = await fixture(t, {save:() => new Promise(resolve => { resolveSave = resolve; }),
        load:() => ++loadCount === 1 ? [{id:'old', score:5, recordedAt:at}] : new Promise(resolve => { resolveLoad = resolve; })});
    f.ui.openHistory(); await tick();
    assert.equal(f.doc.querySelectorAll('.satisfaction-history-table tbody tr').length, 1);
    f.owner('owner-b');
    assert.equal(f.doc.querySelector('.satisfaction-history-body').childElementCount, 0, 'previous account records are removed even from the closed dialog DOM');
    assert.equal(f.doc.getElementById('sobrietySatisfactionDialog').open, false);
    f.owner('owner-a');
    f.choose(4); f.submit(); f.ui.openHistory();
    assert.equal(f.doc.getElementById('sobrietySatisfactionDialog').open, true);
    f.owner('owner-b');
    assert.equal(f.doc.getElementById('sobrietySatisfactionDialog').open, false);
    assert.equal(f.doc.querySelector('.satisfaction-history-body').childElementCount, 0);
    resolveSave(); resolveLoad([{id:'old', score:5, recordedAt:at}]); await tick();
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input:checked').length, 0);
    assert.equal(f.doc.querySelector('.satisfaction-latest').hidden, true);
    assert.doesNotMatch(f.doc.querySelector('.satisfaction-status').textContent, /기록했어요/);
    f.owner(null);
    assert.equal(f.doc.querySelector('.satisfaction-stars').disabled, true);
    assert.equal(f.doc.querySelector('.satisfaction-history-button').disabled, true);
});

test('empty/error history supports retry, and closing invalidates a pending fetch', async t => {
    let count = 0, resolveLoad;
    const f = await fixture(t, {load:async () => {
        count++;
        if (count === 1) throw new Error('offline');
        if (count === 2) return [];
        return new Promise(resolve => { resolveLoad = resolve; });
    }});
    f.ui.openHistory(); await tick();
    assert.match(f.doc.querySelector('.satisfaction-empty').textContent, /불러오지 못/);
    f.doc.querySelector('.satisfaction-retry').click(); await tick();
    assert.match(f.doc.querySelector('.satisfaction-empty').textContent, /아직 만족도 기록이 없/);
    f.doc.querySelector('.satisfaction-close').click();
    f.ui.openHistory(); f.doc.querySelector('.satisfaction-close').click();
    resolveLoad([{id:'late', score:2, recordedAt:at}]); await tick();
    assert.equal(f.doc.querySelector('.satisfaction-chart'), null);
});

test('all exact records remain accessible through filters, chart points and pagination', async t => {
    const rows = Array.from({length:45}, (_,index) => ({id:`row-${index}`, score:index % 5 + 1, recordedAt:at - index * 86400000}));
    const f = await fixture(t, {load:async () => rows});
    f.ui.openHistory(); await tick();
    assert.equal(f.doc.querySelectorAll('.satisfaction-chart-point').length, 30);
    assert.equal(f.doc.querySelectorAll('.satisfaction-history-table tbody tr').length, 20);
    f.doc.querySelector('[data-satisfaction-period="7"]').click();
    assert.equal(f.doc.querySelectorAll('.satisfaction-chart-point').length, 7);
    f.doc.querySelector('[data-satisfaction-period="all"]').click();
    assert.equal(f.doc.querySelectorAll('.satisfaction-chart-point').length, 45);
    f.doc.querySelector('.satisfaction-more').click();
    assert.equal(f.doc.querySelectorAll('.satisfaction-history-table tbody tr').length, 40);
    f.doc.querySelector('.satisfaction-more').click();
    assert.equal(f.doc.querySelectorAll('.satisfaction-history-table tbody tr').length, 45);
    assert.equal(f.doc.querySelector('.satisfaction-more'), null);
    const dot = f.doc.querySelector('.satisfaction-chart-point');
    dot.dispatchEvent(new f.w.Event('focus'));
    assert.match(f.doc.querySelector('.satisfaction-selected').textContent, /2026-09-10/);
    assert.match(f.doc.querySelector('.satisfaction-selected').textContent, /5\/5점/);
});

test('returning to the app and explicit timer reopening reset only an unfinished draft', async t => {
    const f = await fixture(t);
    f.choose(4); f.ui.resetDraft();
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input:checked').length, 0);
    f.choose(5); f.w.dispatchEvent(new f.w.Event('pageshow'));
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input:checked').length, 0);
    f.choose(2); Object.defineProperty(f.doc, 'visibilityState', {configurable:true, value:'visible'});
    f.doc.dispatchEvent(new f.w.Event('visibilitychange'));
    assert.equal(f.doc.querySelectorAll('.satisfaction-stars input:checked').length, 0);
    assert.equal(f.saved.length, 0);
});
