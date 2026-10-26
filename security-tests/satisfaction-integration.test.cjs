const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {test} = require('node:test'), assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const installStart = source.indexOf('    const sobrietySatisfaction = installSobrietySatisfaction(');
const installEnd = source.indexOf("    document.addEventListener('app:sectiontoggle'", installStart);
function adapter() {
    const writes = [];
    const context = {userId:'owner', auth:{currentUser:{uid:'owner'}}, db:{}, dailyLogsData:{'2026-10-24':{weight:65,alcohol:0}},
        installSobrietySatisfaction(options) {context.options=options;return{};},
        doc:(_, ...parts) => parts, collection:(_, ...parts) => parts,
        arrayUnion:entry => ({atomicUnion:entry}),
        setDoc:async (ref, data, options) => writes.push({ref,data,options}),
        getDocs:async () => ({docs:[]}), entriesFromDailyLogs:logs => Object.values(logs).flatMap(row=>row.sobrietySatisfaction||[])};
    vm.createContext(context);vm.runInContext(source.slice(installStart, installEnd), context);
    return {context, writes, options:context.options};
}
test('satisfaction persists atomically in the account daily log without replacing other daily data', async () => {
    const {context,writes,options}=adapter(), entry={id:'entry1',day:'2026-10-24',score:4,recordedAt:1792800000000};
    await options.saveEntry('owner',entry);
    assert.deepEqual([...writes[0].ref],['users','owner','daily_logs','2026-10-24']);
    assert.deepEqual(Object.keys(writes[0].data),['sobrietySatisfaction']);
    assert.equal(writes[0].data.sobrietySatisfaction.atomicUnion,entry);
    assert.equal(writes[0].options.merge,true);
    assert.equal(context.dailyLogsData[entry.day].weight,65);
    assert.equal(context.dailyLogsData[entry.day].sobrietySatisfaction[0],entry);
    await options.saveEntry('owner',entry);
    assert.equal(context.dailyLogsData[entry.day].sobrietySatisfaction.length,1);
    context.auth.currentUser={uid:'other'};
    await assert.rejects(options.saveEntry('owner',entry),/account-changed/);
    assert.equal(writes.length,2);
});
test('late satisfaction reads and writes cannot enter the next account cache', async () => {
    const {context,options}=adapter();let finish;
    context.setDoc=()=>new Promise(resolve=>{finish=resolve;});
    const pending=options.saveEntry('owner',{id:'entry1',day:'2026-10-24',score:4,recordedAt:1792800000000});
    context.userId='other';context.auth.currentUser={uid:'other'};context.dailyLogsData={};finish();await pending;
    assert.deepEqual(Object.keys(context.dailyLogsData),[]);
    context.userId='owner';context.auth.currentUser={uid:'owner'};
    context.getDocs=()=>new Promise(resolve=>{finish=resolve;});
    const read=options.loadEntries('owner');
    context.userId='other';context.auth.currentUser={uid:'other'};
    finish({docs:[{id:'2026-10-24',data:()=>({sobrietySatisfaction:[{id:'private'}]})}]});
    await assert.rejects(read,/account-changed/);
});
test('meal and weight edits never resend a stale cached satisfaction array', async () => {
    const {context,writes}=adapter();
    context.dailyLogsData['2026-10-24'].sobrietySatisfaction=[{id:'stale'}];
    context.refreshActivitySummaries=()=>{};context.invalidateMainDaysContainerRender=()=>{};
    const start=source.indexOf('    async function mergeDailyLog('),end=source.indexOf('\n    async function syncFailureAlcohol',start);
    vm.runInContext(source.slice(start,end),context);
    await context.mergeDailyLog('2026-10-24',{weight:66});
    assert.equal(writes[0].data.weight,66);
    assert.equal(Object.hasOwn(writes[0].data,'sobrietySatisfaction'),false);
    assert.equal(Object.hasOwn(writes[0].data,'alcohol'),false);
    assert.equal(writes[0].options.merge,true);
});
test('rating stays below the live timer outside calendar click targets', () => {
    const start=source.indexOf('    function buildMainDaysContainerHtml('),end=source.indexOf('\n    function renderMainDaysContainerIfNeeded',start);
    const context={buildStreakRecordBadgeHtml:()=>'',buildMinAbstinenceProgressHtml:()=>'',recoveryGoalsHtml:()=>'',getCurrentRecoveryGoals:()=>[]};
    vm.createContext(context);vm.runInContext(source.slice(start,end),context);
    const dom=new JSDOM(context.buildMainDaysContainerHtml(12,30,90));
    const slot=dom.window.document.getElementById('sobrietySatisfactionSlot');
    assert(slot);assert.equal(slot.closest('.clickable-time-box'),null);
    assert.equal(slot.previousElementSibling.id,'timerClockProgressSlot');
    assert(slot.previousElementSibling.previousElementSibling.matches('.time-unit-row'));
    dom.window.close();
});

test('satisfaction-only days do not become zero-valued meal or drinking chart records', async () => {
    const dom=new JSDOM('<div id="mealWeightLogListContainer"></div>');
    const context={userId:'owner',document:dom.window.document,db:{},dailyLogsData:{},mealWeightChartInstance:null,
        closeModal(){},openModal(){},collection(){},query(){},
        getDocs:async()=>({forEach:fn=>fn({id:'2026-10-24',data:()=>({sobrietySatisfaction:[{id:'only',score:4,recordedAt:1792800000000}]})})})};
    context.window=context;vm.createContext(context);
    const start=source.indexOf('    window.openMealWeightLogList = async function() {');
    const end=source.indexOf('\n    };',start)+7;
    vm.runInContext(source.slice(start,end),context);
    await context.openMealWeightLogList();
    assert.match(dom.window.document.getElementById('mealWeightLogListContainer').textContent,/아직 기록된/);
    assert.equal(context.dailyLogsData['2026-10-24'].sobrietySatisfaction.length,1);
    dom.window.close();
});

test('timer redraw preserves live clock nodes and satisfaction draft while keeping record actions separate', () => {
    const page=new JSDOM(source), clock=page.window.document.getElementById('timerClockProgress').outerHTML;
    page.window.close();
    const dom=new JSDOM('<div id="mainDaysContainer"></div>'+clock,{runScripts:'dangerously'}),d=dom.window.document;
    const form=d.createElement('form');form.className='sobriety-satisfaction';form.innerHTML='<input value="draft">';
    const calls=[],context={document:d,currentTabName:'physical',lastMainDaysRenderState:null,
        refreshRecoverySummary:()=>calls.push('recovery'),getCurrentStreakRecordInfo:()=>({targetDays:47,rank:1}),
        buildMainDaysRenderKey:(...args)=>args.join('|'),getCurrentRecoveryGoals:()=>[],
        recoveryGoalsHtml:()=>'<details class="current-recovery-stack"></details>',buildMinAbstinenceProgressHtml:()=>'',
        sobrietySatisfaction:{mount:host=>host.append(form)},dailyWisdom:{renderTrigger(){}},
        openStreakRecordsModal:()=>calls.push('record'),openSobrietyRate:()=>calls.push('rate')};
    dom.window.openCalendarModal=mode=>calls.push(mode);
    vm.createContext(context);
    for(const name of ['buildStreakRecordBadgeHtml','buildMainDaysContainerHtml','renderMainDaysContainerIfNeeded']) {
        const start=source.indexOf(`    function ${name}(`),end=source.indexOf('\n    }',start)+6;
        vm.runInContext(source.slice(start,end),context);
    }
    const live=d.getElementById('timerClockProgress'),bar=d.getElementById('barHourFill');
    bar.style.width='75%';d.getElementById('subTime').textContent='18시간 36분 50초';
    context.renderMainDaysContainerIfNeeded(47,125,97.28);
    form.querySelector('input').focus();
    context.renderMainDaysContainerIfNeeded(48,126,97.3);
    assert.equal(d.getElementById('timerClockProgress'),live);
    assert.equal(d.getElementById('barHourFill'),bar);
    assert.equal(bar.style.width,'75%');
    assert.equal(d.getElementById('subTime').textContent,'18시간 36분 50초');
    assert.equal(d.querySelector('#timerClockProgressSlot').firstElementChild,live);
    assert.equal(form.querySelector('input').value,'draft');assert.equal(d.activeElement,form.querySelector('input'));
    calls.length=0;
    for(const selector of ['.time-unit','.sub-time-clickable','.streak-record-badge','.success-rate-box'])d.querySelector(selector).click();
    assert.deepEqual(calls,['current','accumulated','record','rate']);
    calls.length=0;context.renderMainDaysContainerIfNeeded(48,126,97.3);
    assert.deepEqual(calls,['recovery'],'heading progress refreshes even when timer render key is unchanged');
    dom.window.close();
});
