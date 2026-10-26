const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'recovery-goals.js'), 'utf8');
const api = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const groups = [
    {key:'physical', label:'신체', stages:[{d:1,t:'1일 목표'}, {d:10,t:'10일 목표'}]},
    {key:'liver', label:'간', stages:[{d:1,t:'1일 목표'}, {d:20,t:'20일 목표'}]},
    {key:'brain', label:'뇌', stages:[{d:1,t:'1일 목표'}, {d:30,t:'30일 목표'}]}
];

test('recovery heading uses each current goal and its existing duration percentage, in liver/brain/body order', async () => {
    const {currentRecoveryGoals,recoveryGoalsSummary} = await api;
    const goals = currentRecoveryGoals(groups, 5);
    assert.equal(recoveryGoalsSummary(goals), '기간 기준 · 간 목표 20일 목표 · 25%  /  뇌 목표 30일 목표 · 16%  /  신체 목표 10일 목표 · 50%');
    assert.deepEqual(goals.map(goal => goal.key), ['physical','liver','brain'], 'summary must not reorder the timer cards');
});

test('recovery preview advances stages at a boundary and labels completed final goals honestly', async () => {
    const {currentRecoveryGoals,recoveryGoalsSummary} = await api;
    const atBoundary = recoveryGoalsSummary(currentRecoveryGoals(groups, 1));
    assert.ok(atBoundary.includes('간 목표 20일 목표 · 5%'));
    assert.ok(!atBoundary.includes('1일 목표'));
    const done = recoveryGoalsSummary(currentRecoveryGoals(groups, 40));
    assert.equal((done.match(/달성 100%/g) || []).length, 3);
    assert.ok(!done.includes('진행 중'));
    assert.equal(recoveryGoalsSummary([]), '');
});

function previewState({uid='member-a', authUid=uid, start='2026-10-01T00:00:00Z'}={}) {
    const refresh = html.match(/    function refreshRecoverySummary\(\) \{[\s\S]*?\n    \}/)?.[0];
    assert.ok(refresh, 'index integrates the recovery preview renderer');
    const calls = [];
    const context = {
        userId:uid, auth:{currentUser:authUid ? {uid:authUid} : null}, userQuitDate:start,
        Date:class extends Date { static now() {return Date.parse('2026-10-27T03:00:00Z');} },
        recordSectionUI:{setSummary:(...args) => calls.push(args)},
        getCurrentRecoveryGoals:() => [{key:'liver'}],
        recoveryGoalsSummary:goals => { assert.equal(goals[0].key,'liver'); return '기간 기준 · 간 목표 · 50%'; }
    };
    vm.runInNewContext(`${refresh}\nrefreshRecoverySummary();`, context);
    return calls.at(-1);
}

test('live recovery preview shows the signed-in active challenge and keeps pending/invalid challenges empty', () => {
    assert.equal(previewState()[1], '기간 기준 · 간 목표 · 50%');
    const pending = previewState({start:'2026-11-01T00:00:00Z'});
    assert.equal(pending[1], '');
    assert.equal(pending[2], '금주 도전 시작 예정');
    for (const options of [{uid:null}, {authUid:'other-member'}, {start:null}, {start:'invalid'}]) {
        const state = previewState(options);
        assert.equal(state[1], '');
        assert.equal(state[2], '도전을 시작하면 현재 회복 목표가 표시됩니다');
    }
});

test('recovery heading reuses scrolling summary markup with a screen-reader-hidden duplicate', () => {
    const section = html.match(/<details id="sectionRecovery"[\s\S]*?<\/summary>/)?.[0];
    assert.ok(section?.includes('id="sectionRecoveryPreview"'));
    assert.ok(section.includes('class="diagnosis-summary-track"'));
    assert.ok(section.includes('aria-hidden="true" hidden'));
    assert.ok(section.includes('class="diagnosis-summary-heading record-summary-heading"'));
    assert.match(html, /window\.startApp = function\(startISO\) \{[\s\S]*?refreshRecoverySummary\(\);/);
});
