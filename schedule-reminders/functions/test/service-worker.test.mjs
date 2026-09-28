import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../../../firebase-messaging-sw.js', import.meta.url), 'utf8');

function setup(windowClients = []) {
    const shown = [], opened = [], listeners = {}; let background;
    const context = {URL, Set, console: {log() {}}, importScripts() {},
        self: {location: {origin: 'https://www.alcoholaway.com'}, addEventListener: (type, cb) => { listeners[type] = cb; }, registration: {showNotification: async (...args) => { shown.push(args); }}},
        clients: {matchAll: async () => windowClients, openWindow: async url => { opened.push(url); }},
        firebase: {initializeApp() {}, messaging: () => ({onBackgroundMessage: cb => { background = cb; }})}};
    vm.runInNewContext(source, context);
    return {shown, opened, background: payload => background(payload), async click(data) { let pending; listeners.notificationclick({notification: {data, close() {}}, waitUntil: value => { pending = value; }}); await pending; }};
}

test('data-only schedule push keeps a unique tag and waits for the notification promise', async () => {
    const sw = setup();
    await sw.background({data: {kind: 'daily-schedule', title: '일정', body: '진료', tag: 'daily-schedule-id-1', url: 'https://www.alcoholaway.com/?schedule=schedule-0000000001'}});
    assert.equal(sw.shown.length, 1); assert.equal(sw.shown[0][1].tag, 'daily-schedule-id-1'); assert.equal(sw.shown[0][1].renotify, false);
});
test('SDK notification payload does not get displayed a second time', async () => {
    const sw = setup(); await sw.background({notification: {title: '기존 푸시'}}); assert.equal(sw.shown.length, 0);
});
test('notification click routes an existing index page without replacing the diary', async () => {
    const messages = []; let focus = 0;
    const sw = setup([{url: 'https://www.alcoholaway.com/', focus: async () => { focus++; }, postMessage: value => messages.push(value)}]);
    await sw.click({url: 'https://www.alcoholaway.com/?schedule=schedule-0000000001'});
    assert.equal(messages[0].id, 'schedule-0000000001'); assert.equal(focus, 1); assert.equal(sw.opened.length, 0);
});
test('notification click opens a new schedule page and rejects foreign URLs', async () => {
    const sw = setup(); await sw.click({url: 'https://www.alcoholaway.com/?schedule=schedule-0000000001'});
    assert.equal(sw.opened[0], 'https://www.alcoholaway.com/?schedule=schedule-0000000001');
    await sw.click({url: 'https://malicious.example/'}); assert.equal(sw.opened[1], 'https://www.alcoholaway.com/');
});
