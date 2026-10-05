// Run real index.html functions against local DOM/Firestore doubles.
// No production credentials, network resources, or database writes are used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const hash = value => "'sha256-" + crypto.createHash('sha256').update(value).digest('base64') + "'";
const payload = '<img data-audit onerror="window.__auditProbe=42"><svg onload="window.__auditProbe=42"></svg>';
const quotePayload = "'-window.auditMark()-'";

function extract(name) {
    const start = source.indexOf(`    window.${name} = `);
    const end = source.indexOf('\n    };', start);
    assert(start >= 0 && end > start, `function ${name} found`);
    return source.slice(start, end + '\n    };'.length);
}

function fixture(t) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://audit.invalid/', runScripts: 'dangerously', virtualConsole: vc});
    const w = dom.window;
    t.after(() => { dom.window.close(); assert.deepEqual(errors, [], 'no unexpected script errors'); });
    for (const id of ['allCravingsContainer', 'loadMoreCravingsBtn', 'historyListContainer', 'historyDetailTitle', 'historyDetailSummary', 'cravingCount', 'postList']) {
        const el = w.document.createElement('div'); el.id = id; w.document.body.append(el);
    }
    for (const id of ['cravingRange', 'cravingReason', 'etcReason', 'createStartDateInput', 'createEndDateInput', 'createStartReasonInput', 'createFailReasonInput', 'createFailAmountInput', 'editStartReasonInput', 'editFailReasonInput', 'editFailAmountInput']) {
        const el = w.document.createElement('textarea'); el.id = id; w.document.body.append(el);
    }
    Object.assign(w, {
        userId: 'offline-user', currentChallengeId: 'offline-challenge', editingChallengeId: null,
        db: {}, cravingData: [], cravingsCurrentPage: 0, allCravingsList: [], __auditProbe: 0,
        closeModal() {}, openModal() {}, alert() {}, setTimeout() {}, loadMotivationalStats() {}, refreshActivitySummaries() {},
        openHistoryList() {}, auditMark() { w.__auditProbe++; return 0; },
        clampNumber: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
        doc: (...args) => args, collection: (...args) => args, query: (...args) => args,
        orderBy: (...args) => args, limit: value => value, arrayUnion: value => [value],
        updateDoc: async (_, data) => { w.savedUpdate = data; },
        addDoc: async (_, data) => { w.savedChallenge = data; return {id: 'offline-challenge'}; },
        historyId: 'offline-challenge',
        getDocs: async () => ({empty: false, docs: [{get id() {return w.historyId;}, data: () => w.savedChallenge}]}),
        unsubscribePosts: null, pendingCommunityComments: new Set(),
        COMMUNITY_CHEERS: [{id: 'support', label: '응원', emoji: '💪'}],
        communityTimeMs: value => Number(value), communityDayBadge: () => '',
        communityCommentKey: (uid, id) => JSON.stringify([uid, id]),
        onSnapshot: (_, callback) => { callback({empty: false, forEach: fn => fn({id: w.postId, data: () => w.post})}); return () => {}; }
    });
    const start = source.indexOf('    function escapeHtml(value) {');
    w.eval(source.slice(start, source.indexOf('\n    }', start) + '\n    }'.length));
    return w;
}

function assertInert(w, selector, text) {
    const container = w.document.querySelector(selector);
    assert.equal(container.querySelectorAll('img, svg, script, iframe, [onerror], [onload]').length, 0);
    assert(container.textContent.includes(text), 'original text remains readable');
    assert.equal(w.__auditProbe, 0);
}

test('craving input is saved verbatim and displayed only as text', async t => {
    const w = fixture(t);
    w.document.getElementById('cravingRange').value = '5';
    w.document.getElementById('cravingReason').value = '기타';
    w.document.getElementById('etcReason').value = payload;
    w.eval(extract('submitCraving'));
    await w.submitCraving();
    assert.equal(w.savedUpdate.cravings[0].reason, payload);
    w.allCravingsList = w.savedUpdate.cravings;
    w.eval(extract('renderCravingsList'));
    w.renderCravingsList();
    assertInert(w, '#allCravingsContainer', payload);
});

for (const field of ['startReason', 'failReason']) {
    for (const view of ['list', 'detail']) {
        test(`${field} remains inert after saving and opening the ${view}`, async t => {
            const w = fixture(t);
            w.document.getElementById('createStartDateInput').value = '2026-01-01T12:00';
            w.document.getElementById('createEndDateInput').value = '2026-01-02T12:00';
            w.document.getElementById(field === 'startReason' ? 'createStartReasonInput' : 'createFailReasonInput').value = payload;
            w.eval(extract('saveManualHistory'));
            await w.saveManualHistory();
            assert.equal(w.savedChallenge[field], payload);
            if (view === 'list') {
                w.eval(extract('openHistoryList')); await w.openHistoryList();
                assertInert(w, '#historyListContainer', payload);
            } else {
                w.eval(extract('openHistoryDetail')); w.openHistoryDetail(w.savedChallenge);
                assertInert(w, '#historyDetailSummary', payload);
            }
        });
    }
}

test('quoted record values are data when selecting or editing history', async t => {
    const w = fixture(t);
    const text = quotePayload + '\n100% & "한글" <태그>';
    w.savedChallenge = {startDate: '2026-01-01T12:00', status: 'failed', cravings: [], startReason: text, failReason: text, failAmount: 5};
    w.historyId = quotePayload;
    w.eval(extract('openHistoryList'));
    w.eval(extract('openHistoryDetail'));
    w.eval(extract('openEditReasonModal'));
    let selected = 0;
    const showDetail = w.openHistoryDetail;
    w.openHistoryDetail = data => {selected++; assert.equal(data, w.savedChallenge); showDetail(data);};
    await w.openHistoryList();
    w.document.querySelector('.history-item').click();
    assert.equal(selected, 1);
    assert(w.document.querySelector('#historyDetailSummary').textContent.includes(quotePayload));
    w.document.querySelector('[data-history-action="edit-reason"]').click();
    assert.equal(selected, 1, 'edit stops the parent record click');
    assert.equal(w.editingChallengeId, quotePayload);
    assert.equal(w.document.getElementById('editStartReasonInput').value, text);
    assert.equal(w.document.getElementById('editFailReasonInput').value, text);
    assert.equal(w.document.querySelectorAll('#historyListContainer [onclick]').length, 0);
    assert.equal(w.__auditProbe, 0);
});

for (const action of ['delete', 'resume', 'edit-time']) {
    test(`history ${action} receives its original document ID without code interpretation`, async t => {
        const w = fixture(t);
        w.historyId = quotePayload;
        w.savedChallenge = {startDate: '2026-01-01T12:00', status: action === 'edit-time' ? 'active' : 'failed', cravings: []};
        let called = 0;
        w[{delete: 'deleteHistory', resume: 'resumeHistory', 'edit-time': 'openEditTimeModal'}[action]] = (event, id) => {
            event.stopPropagation(); assert.equal(id, quotePayload); called++;
        };
        w.openHistoryDetail = () => assert.fail('action must not open detail');
        w.eval(extract('openHistoryList')); await w.openHistoryList();
        w.document.querySelector(`[data-history-action="${action}"]`).click();
        assert.equal(called, 1); assert.equal(w.__auditProbe, 0);
    });
}

test('community listeners preserve quoted IDs, escaped content and comment actions', t => {
    const w = fixture(t);
    w.postId = quotePayload;
    w.post = {uid: w.userId, author: payload, content: payload, createdAt: Date.now(), comments: [{uid: w.userId, author: payload, text: payload}]};
    const calls = [];
    for (const method of ['editPost', 'deletePost', 'addComment', 'deleteComment']) {
        w[method] = (...args) => {assert.equal(args[0], quotePayload); calls.push([method, ...args]);};
    }
    w.eval(extract('loadPosts')); w.loadPosts();
    assertInert(w, '#postList', payload);
    assert.equal(w.document.querySelectorAll('#postList [onclick]').length, 0);
    for (const action of ['edit', 'delete', 'comment', 'delete-comment', 'cheer']) {
        w.document.querySelector(`[data-community-action="${action}"]`).click();
    }
    assert.equal(calls.length, 5);
    assert.equal(decodeURIComponent(calls[0][2]), payload);
    assert.equal(calls[3][2], 0);
    assert.equal(calls[4][2], 'support');
    assert.equal(w.__auditProbe, 0);
});

test('CSP permits each shipped inline script and fixed handler, not arbitrary JavaScript', () => {
    const dom = new JSDOM(source);
    const doc = dom.window.document;
    const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
    assert(meta && meta.parentElement === doc.head);
    assert(meta.compareDocumentPosition(doc.querySelector('script')) & 4, 'policy precedes scripts');
    const directives = new Map(meta.content.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
    const scripts = directives.get('script-src'), attrs = directives.get('script-src-attr');
    for (const keyword of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:']) assert(!scripts.includes(keyword));
    assert(!attrs.includes("'unsafe-inline'")); assert(attrs.includes("'unsafe-hashes'"));
    assert.deepEqual(directives.get('object-src'), ["'none'"]);
    assert.deepEqual(directives.get('base-uri'), ["'none'"]);
    for (const script of doc.querySelectorAll('script:not([src])')) if (script.textContent.trim()) assert(scripts.includes(hash(script.textContent)));
    for (const el of doc.querySelectorAll('*')) for (const attr of el.attributes) if (/^on/i.test(attr.name)) assert(attrs.includes(hash(attr.value)), attr.value);
    for (const match of source.matchAll(/\son[a-z]+="([^"]*)"/g)) {
        assert(!match[1].includes('${'), 'no interpolated inline handlers');
        const decoder = doc.createElement('textarea'); decoder.innerHTML = match[1];
        assert(attrs.includes(hash(decoder.value)), `generated fixed handler: ${decoder.value}`);
    }
    for (const probe of ['window.__auditProbe=42', 'window.auditMark()', quotePayload]) {
        assert(!scripts.includes(hash(probe))); assert(!attrs.includes(hash(probe)));
    }
    for (const script of doc.querySelectorAll('script[src*="cdn.jsdelivr.net"]')) {
        assert(/@\d+\.\d+\.\d+\//.test(script.src));
        assert(/^sha384-[\w+/]{64}$/.test(script.getAttribute('integrity')));
        assert.equal(script.crossOrigin, 'anonymous'); assert(scripts.includes(script.src));
    }
    assert(scripts.includes('https://www.gstatic.com/firebasejs/'));
    assert(directives.get('frame-src').includes('https://alcoholaway.firebaseapp.com'));
    assert(directives.get('connect-src').includes('https://www.google.com/recaptcha/'));
    dom.window.close();
});

test('all inline JavaScript parses and CSP hashes match the source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcoholaway-security-'));
    try {
        let i = 0;
        for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (!match[2].trim()) continue;
            const file = path.join(dir, `script-${i++}.${/type="module"/.test(match[1]) ? 'mjs' : 'cjs'}`);
            fs.writeFileSync(file, match[2]); execFileSync(process.execPath, ['--check', file]);
        }
        execFileSync('python3', [path.join(root, 'scripts/update-index-csp.py'), '--check']);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
