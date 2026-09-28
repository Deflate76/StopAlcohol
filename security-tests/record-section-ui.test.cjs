const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {test} = require('node:test');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const uiModule = import(pathToFileURL(path.join(root, 'record-section-ui.js')));
const DAY = 86400000;
const releasedAt = '2026-09-28T23:21:30+09:00';
const releasedMs = Date.parse(releasedAt);

function extractFunction(name) {
    const start = html.indexOf(`    function ${name}(`);
    const end = html.indexOf('\n    }', start);
    assert(start >= 0 && end > start);
    return html.slice(start, end + '\n    }'.length);
}

async function fixture(t) {
    const dom = new JSDOM(`<!doctype html><body>
      <button><span id="diagnosisActiveNames"><span id="diagnosisActiveNamesTrack"><span id="diagnosisActiveNamesText"></span><span id="diagnosisActiveNamesRepeat" aria-hidden="true" hidden></span></span></span></button>
      <div id="diagnosisRecordList"></div><span id="subTimePercent"></span><span id="subDayPercent"></span>
      <span data-section-new="sectionCraving" hidden>New</span><span data-section-new="sectionStats" hidden>New</span>
      <span data-section-new="sectionRecovery" hidden>New</span></body>`, {url:'https://fixture.invalid/', runScripts:'dangerously', virtualConsole:new VirtualConsole()});
    t.after(() => dom.window.close());
    const w = dom.window, doc = w.document, frames = [], timers = new Map();
    let time = releasedMs, timerId = 0;
    w.requestAnimationFrame = callback => {frames.push(callback); return frames.length;};
    w.setTimeout = (callback, delay) => {timers.set(++timerId, {callback, delay}); return timerId;};
    w.clearTimeout = id => timers.delete(id);
    const module = await uiModule;
    const ui = module.installRecordSectionUI({document:doc, window:w, now:() => time, updates:{
        activeRecoverySummary:releasedAt, sectionCraving:releasedAt, sectionStats:releasedAt, sectionRecovery:releasedAt
    }});
    const flushFrames = () => {for (const callback of frames.splice(0)) callback();};
    Object.assign(w, {
        recordSectionUI:ui, hr:{entries:[], errors:{}, loaded:{health:true}, uid:'owner', busy:false},
        hrEl:id => doc.getElementById(id), hrRefreshMinAbstinenceProgress() {},
        hrValidDate:value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
        hrDayNumber:value => Date.parse(value)/DAY, hrToday:() => '2026-09-28',
        hrSameUser:() => true, hrAbstinencePlan:() => null
    });
    for (const name of ['escapeHtml', 'hrRecoveryDetails', 'hrRenderDiagnoses']) w.eval(extractFunction(name));
    return {w, doc, ui, flushFrames, timers, setTime:value => {time=value;}};
}

test('diagnosis heading lists only current unrecovered names, comma-separated and deduplicated', async t => {
    const {w, doc} = await fixture(t);
    w.hr.entries = [{id:'one', date:'2026-09-28', diagnoses:[
        {name:'전정신경염',date:'2026-09-25'},
        {name:'대상포진',date:'2026-09-24'},
        {name:'전정신경염',date:'2026-09-23'},
        {name:'회복한 질환',date:'2026-09-22',recoveredDate:'2026-09-27'},
        {name:'미래 진단',date:'2026-10-01'}
    ]}];
    w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,'전정신경염, 대상포진');
    assert.equal(doc.querySelectorAll('#diagnosisRecordList .diagnosis-row').length,5,'the full history remains available');
    w.hr.entries[0].diagnoses[0].recoveredDate = '2026-09-28';
    w.hr.entries[0].diagnoses[2].recoveredDate = '2026-09-28';
    w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,'대상포진');
});

test('diagnosis text is inert HTML and clears on account reset, loading and errors', async t => {
    const {w, doc} = await fixture(t);
    const name = '<img src=x onerror="alert(1)">';
    w.hr.entries = [{id:'one',date:'2026-09-28',diagnoses:[{name,date:'2026-09-28'}]}];
    w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,name);
    assert.equal(doc.querySelectorAll('img').length,0);
    w.hr.errors.health = '조회 실패'; w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,'진단 기록 확인 필요');
    delete w.hr.errors.health; w.hr.entries = []; w.hr.loaded.health = false; w.hrRenderDiagnoses();
    assert.match(doc.getElementById('diagnosisActiveNamesText').textContent,/불러오는 중/);
    w.hr.uid = null; w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,'회복 중인 질환 없음');
    assert.equal(doc.getElementById('diagnosisActiveNamesRepeat').textContent,'');
});

test('diagnosis ticker starts only on overflow and stops when resized to fit', async t => {
    const {w, doc, ui, flushFrames} = await fixture(t);
    const viewport=doc.getElementById('diagnosisActiveNames'), primary=doc.getElementById('diagnosisActiveNamesText');
    let available=120;
    Object.defineProperty(viewport,'clientWidth',{get:() => available});
    Object.defineProperty(primary,'scrollWidth',{get:() => 500});
    ui.setDiagnosisNames(['긴 병명 하나','긴 병명 둘']); flushFrames();
    assert(viewport.classList.contains('is-overflowing'));
    assert.equal(doc.getElementById('diagnosisActiveNamesRepeat').hidden,false);
    assert.equal(doc.getElementById('diagnosisActiveNamesRepeat').getAttribute('aria-hidden'),'true');
    assert.equal(doc.getElementById('diagnosisActiveNamesTrack').style.getPropertyValue('--diagnosis-scroll-distance'),'524px');
    available=600; w.dispatchEvent(new w.Event('resize')); flushFrames();
    assert(!viewport.classList.contains('is-overflowing'));
    assert.equal(doc.getElementById('diagnosisActiveNamesRepeat').hidden,true);
});

test('New badge has an exact seven-day release window and ignores invalid/future dates', async () => {
    const {isRecentSectionUpdate} = await uiModule;
    assert.equal(isRecentSectionUpdate(releasedAt,releasedMs-1),false);
    assert.equal(isRecentSectionUpdate(releasedAt,releasedMs),true);
    assert.equal(isRecentSectionUpdate(releasedAt,releasedMs+7*DAY-1),true);
    assert.equal(isRecentSectionUpdate(releasedAt,releasedMs+7*DAY),false);
    assert.equal(isRecentSectionUpdate('invalid',releasedMs),false);
});

test('New expires while the page is open and rerendering cannot restart its week', async t => {
    const {doc,ui,timers,setTime} = await fixture(t);
    assert([...doc.querySelectorAll('[data-section-new]')].every(badge => !badge.hidden));
    setTime(releasedMs+6*DAY);
    const summaryBadge=doc.createElement('span'); summaryBadge.dataset.sectionNew='activeRecoverySummary';doc.body.append(summaryBadge);
    ui.refreshFeatureBadges();
    assert.equal(summaryBadge.hidden,false);
    const timer=[...timers.values()][0]; assert.equal(timer.delay,DAY);
    setTime(releasedMs+7*DAY); timer.callback();
    assert([...doc.querySelectorAll('[data-section-new]')].every(badge => badge.hidden));
    ui.refreshFeatureBadges();
    assert([...doc.querySelectorAll('[data-section-new]')].every(badge => badge.hidden));
    assert.equal(timers.size,0);
});

test('24-hour percentages distinguish challenge remainder from local clock time', async t => {
    const {doc,ui} = await fixture(t);
    const {dayProgress} = await uiModule;
    const noon=new Date(2026,8,28,12,0,0);
    assert.deepEqual(dayProgress(6*3600000,noon),{elapsed:25,today:50});
    assert.equal(dayProgress(DAY,noon).elapsed,0);
    assert.equal(dayProgress(-1000,noon).elapsed,0);
    ui.updateDayProgress(25.25*3600000,new Date(2026,8,28,18,0,0));
    assert.equal(doc.getElementById('subTimePercent').textContent,'5.2%');
    assert.equal(doc.getElementById('subDayPercent').textContent,'75.0%');
    ui.updateDayProgress(0,new Date(2026,8,29,0,0,0));
    assert.equal(doc.getElementById('subDayPercent').textContent,'0.0%');
});

test('index places percentages on the requested sides and removes the diagnosis count', () => {
    const dom=new JSDOM(html), doc=dom.window.document;
    assert.equal(doc.getElementById('diagnosisRecordCount'),null);
    assert.equal(doc.getElementById('subTime').nextElementSibling.id,'subTimePercent');
    assert.equal(doc.getElementById('subPercent').previousElementSibling.id,'subDayPercent');
    for (const id of ['sectionCraving','sectionStats','sectionRecovery']) assert(doc.querySelector(`#${id} > summary [data-section-new="${id}"]`));
    dom.window.close();
});
