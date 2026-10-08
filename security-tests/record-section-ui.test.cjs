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
      <button><span id="diagnosisActiveNames"><span id="diagnosisActiveNamesTrack" class="diagnosis-summary-track"><span id="diagnosisActiveNamesText"></span><span id="diagnosisActiveNamesRepeat" aria-hidden="true" hidden></span></span></span></button>
      <div id="diagnosisRecordList"></div><span id="subTimePercent"></span><span id="subDayPercent"></span>
      <span id="sectionCravingPreview"><span class="diagnosis-summary-track"><span></span><span aria-hidden="true" hidden></span></span></span>
      <button data-activity-categories="craving">갈망 기록</button><button data-activity-categories="body">신체계측</button></body>`, {url:'https://fixture.invalid/', runScripts:'dangerously', virtualConsole:new VirtualConsole()});
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

test('diagnosis heading includes diagnosis dates and inclusive day counts for current unrecovered episodes', async t => {
    const {w, doc} = await fixture(t);
    w.hr.entries = [{id:'one', date:'2026-09-28', diagnoses:[
        {name:'전정신경염',date:'2026-09-25'},
        {name:'대상포진',date:'2026-09-24'},
        {name:'전정신경염',date:'2026-09-23'},
        {name:'회복한 질환',date:'2026-09-22',recoveredDate:'2026-09-27'},
        {name:'미래 진단',date:'2026-10-01'}
    ]}];
    w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,'전정신경염 (4일째 · 2026-09-25 진단), 대상포진 (5일째 · 2026-09-24 진단), 전정신경염 (6일째 · 2026-09-23 진단)');
    assert.equal(doc.querySelectorAll('#diagnosisRecordList .diagnosis-row').length,5,'the full history remains available');
    w.hr.entries[0].diagnoses[0].recoveredDate = '2026-09-28';
    w.hr.entries[0].diagnoses[2].recoveredDate = '2026-09-28';
    w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,'대상포진 (5일째 · 2026-09-24 진단)');
});

test('diagnosis text is inert HTML and clears on account reset, loading and errors', async t => {
    const {w, doc} = await fixture(t);
    const name = '<img src=x onerror="alert(1)">';
    w.hr.entries = [{id:'one',date:'2026-09-28',diagnoses:[{name,date:'2026-09-28'}]}];
    w.hrRenderDiagnoses();
    assert.equal(doc.getElementById('diagnosisActiveNamesText').textContent,`${name} (1일째 · 2026-09-28 진단)`);
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

test('record text and NEW expire at Korean midnight, including when the page stays open', async t => {
    const {doc,ui,timers,setTime} = await fixture(t);
    const at = Date.parse('2026-09-28T23:59:59+09:00');
    setTime(at);
    ui.setActivityData({cravings:[{timestamp:at,strength:6,reason:'저녁 모임'}]});
    const badge = doc.querySelector('[data-activity-categories="craving"] .record-new-badge');
    assert.equal(badge.hidden,false);
    assert.equal(doc.querySelector('[data-activity-categories="body"] .record-new-badge').hidden,true);
    assert.match(doc.getElementById('sectionCravingPreview').textContent,/저녁 모임/);
    const timer = [...timers.values()][0]; assert.equal(timer.delay,1000);
    setTime(at+1000); timer.callback();
    assert.equal(badge.hidden,true);
    assert.equal(doc.getElementById('sectionCravingPreview').textContent,'오늘 입력한 기록 없음');
    ui.setActivityData({cravings:[{timestamp:at,strength:6,reason:'저녁 모임'}]});
    assert.equal(badge.hidden,true,'rerender cannot revive yesterday');
});

test('all section previews keep input as text and clear when the account changes', async t => {
    const {doc,ui} = await fixture(t);
    const input = '<img src=x onerror="alert(1)">';
    ui.setSummary('sectionCravingPreview',input);
    assert.equal(doc.querySelectorAll('img').length,0);
    assert.equal(doc.querySelector('#sectionCravingPreview .diagnosis-summary-track > span').textContent,input);
    ui.setActivityData({});
    assert(!doc.getElementById('sectionCravingPreview').textContent.includes(input));
});

test('24-hour percentages distinguish challenge remainder from local clock time', async t => {
    const {doc,ui} = await fixture(t);
    const {dayProgress} = await uiModule;
    const noon=new Date(2026,8,28,12,0,0);
    assert.deepEqual(dayProgress(6*3600000,noon),{elapsed:25,today:50});
    assert.equal(dayProgress(DAY,noon).elapsed,0);
    assert.equal(dayProgress(-1000,noon).elapsed,0);
    ui.updateDayProgress(25.25*3600000,new Date(2026,8,28,18,0,0));
    assert.equal(doc.getElementById('subTimePercent').textContent,'(5.2%)');
    assert.equal(doc.getElementById('subDayPercent').textContent,'(75.0%)');
    ui.updateDayProgress(0,new Date(2026,8,29,0,0,0));
    assert.equal(doc.getElementById('subDayPercent').textContent,'(0.0%)');
});

test('index places percentages on the requested sides and removes the diagnosis count', () => {
    const dom=new JSDOM(html), doc=dom.window.document;
    assert.equal(doc.getElementById('diagnosisRecordCount'),null);
    assert.equal(doc.getElementById('subTime').nextElementSibling.id,'subTimePercent');
    assert.equal(doc.getElementById('subPercent').nextElementSibling.id,'subDayPercent');
    for (const id of ['sectionCraving','sectionStats','sectionCommunity']) {
        assert(doc.querySelector(`#${id} > summary #${id}Preview`));
        assert.equal(doc.querySelector(`#${id} > summary [data-section-new]`),null);
    }
    assert.equal(doc.getElementById('sectionRecoveryPreview'),null);
    dom.window.close();
});

