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
test('rating slot sits immediately after current-day display outside calendar click targets', () => {
    const start=source.indexOf('    function buildMainDaysContainerHtml('),end=source.indexOf('\n    function renderMainDaysContainerIfNeeded',start);
    const context={buildStreakRecordBadgeHtml:()=>'',buildMinAbstinenceProgressHtml:()=>'',recoveryGoalsHtml:()=>'',getCurrentRecoveryGoals:()=>[]};
    vm.createContext(context);vm.runInContext(source.slice(start,end),context);
    const dom=new JSDOM(context.buildMainDaysContainerHtml(12,30,90));
    const slot=dom.window.document.getElementById('sobrietySatisfactionSlot');
    assert(slot);assert.equal(slot.closest('.clickable-time-box'),null);
    assert(slot.previousElementSibling.querySelector('.time-unit-row'));
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
