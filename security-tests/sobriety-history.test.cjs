const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const mod=file=>import(pathToFileURL(path.join(root,file)));
const sample={createdAt:'2026-10-01',now:'2026-10-14T12:00:00+09:00',challenges:[
    {startDate:'2026-09-25',endDate:'2026-09-30',status:'failed',failAmount:2},
    {startDate:'2026-10-02',endDate:'2026-10-04',status:'failed',failAmount:2},
    {startDate:'2026-10-08',status:'active'}],
    dailyLogs:{'2026-10-04':{alcohol:3},'2026-10-05':{alcohol:2},'2026-10-11':{alcohol:0},'2026-10-15':{alcohol:2}},
    controlSessions:[{drinksList:[{alcoholGrams:2,drinkStartedAt:'2026-10-04T15:00:00Z'}, // Korean Monday, duplicate Oct 5
        {alcoholGrams:2,drinkStartedAt:'2026-10-11T15:00:00Z'}]}]};

test('daily cumulative points match the existing formula for every date, including gaps and deduplicated Korean drinking dates',async()=>{
    const {calculateSobrietyHistory:history,calculateSobrietyRate:rate}=await mod('sobriety-metrics.js');
    const data=history(sample);assert.equal(data.daily.length,13);assert.equal(data.daily[0].date,'2026-10-02');
    for(const row of data.daily){const expected=rate({...sample,now:row.date});assert.equal(row.soberDays,expected.soberDays);assert.equal(row.drinkingDays,expected.drinkingDays);assert.equal(Math.round(row.percent),expected.percent);}
    assert.equal(data.daily[2].drank,true);assert.equal(data.daily[3].drinkingDays,2);
    assert.equal(data.daily.at(-1).drinkingDays,3);assert.equal(data.daily.at(-1).soberDays,10);
    assert.deepEqual(history({...sample,createdAt:null}),{daily:[],weeks:[]});
});
test('weekly rates use Monday-Sunday buckets, partial first/current weeks and no future days',async()=>{
    const {calculateSobrietyHistory:history}=await mod('sobriety-metrics.js');const weeks=history(sample).weeks;
    assert.deepEqual(weeks.map(w=>[w.weekStart,w.startDate,w.endDate,w.totalDays,w.soberDays,w.drinkingDays,w.current]),[
        ['2026-10-12','2026-10-12','2026-10-14',3,2,1,true],
        ['2026-10-05','2026-10-05','2026-10-11',7,6,1,false],
        ['2026-09-28','2026-10-02','2026-10-04',3,2,1,false]]);
    assert.equal(weeks[0].percent,2/3*100);assert.equal(weeks[1].percent,6/7*100);
    const singleton=history({createdAt:'2026-10-12',challenges:[{startDate:'2026-10-12'}],now:'2026-10-12',dailyLogs:{'2026-10-12':{alcohol:1}}});
    assert.equal(singleton.daily[0].percent,0);assert.equal(singleton.weeks[0].totalDays,1);assert.equal(singleton.weeks[0].percent,0);
    const leap=history({createdAt:'2024-02-28',challenges:[{startDate:'2024-02-28'}],now:'2024-03-01'});assert.equal(leap.daily[1].date,'2024-02-29');assert.equal(leap.daily.length,3);
    const year=history({createdAt:'2025-12-31',challenges:[{startDate:'2025-12-31'}],now:'2026-01-05'});assert.equal(year.weeks[0].startDate,'2026-01-05');assert.equal(year.weeks[1].endDate,'2026-01-04');
});
test('editing the date of a drink changes historical values even when today\'s badge stays identical',async()=>{
    const {calculateSobrietyHistory:history,calculateSobrietyRate:rate}=await mod('sobriety-metrics.js');
    const a={createdAt:'2026-10-01',challenges:[{startDate:'2026-10-01'}],now:'2026-10-10',dailyLogs:{'2026-10-03':{alcohol:1}}};
    const b={...a,dailyLogs:{'2026-10-05':{alcohol:1}}};assert.deepEqual(rate(a),rate(b));
    assert.notEqual(history(a).daily[2].percent,history(b).daily[2].percent);
});
test('trend date/slider/range controls expose exact values and weekly table paginates all weeks',async t=>{
    const {calculateSobrietyHistory,calculateSobrietyRate}=await mod('sobriety-metrics.js'),{renderSobrietyDetails}=await mod('sobriety-details.js');
    const dom=new JSDOM(html),w=dom.window,d=w.document;t.after(()=>w.close());
    const input={createdAt:'2026-01-01',challenges:[{startDate:'2026-01-01'}],dailyLogs:{'2026-01-01':{alcohol:1}},now:'2026-10-18'};
    const history=calculateSobrietyHistory(input);renderSobrietyDetails(d,calculateSobrietyRate(input),{history});
    assert.equal(d.querySelector('.sobriety-trend-line').getAttribute('points').split(' ').length,history.daily.length);
    d.querySelector('[data-period="30"]').click();assert.equal(d.querySelector('.sobriety-trend-line').getAttribute('points').split(' ').length,30);
    const date=d.getElementById('sobrietyTrendDate');date.value='2026-01-01';date.dispatchEvent(new w.Event('change'));
    assert.equal(d.querySelector('[data-period="all"]').getAttribute('aria-pressed'),'true');assert.match(d.getElementById('sobrietyTrendValue').textContent,/0.00%/);
    const slider=d.getElementById('sobrietyTrendSlider');slider.value='1';slider.dispatchEvent(new w.Event('input'));assert.equal(date.value,'2026-01-02');assert.match(slider.getAttribute('aria-valuetext'),/50.00%/);
    assert.equal(d.querySelectorAll('.sobriety-weekly-table tbody tr').length,12);
    const more=d.querySelector('.sobriety-weekly>button');while(!more.hidden)more.click();assert.equal(d.querySelectorAll('.sobriety-weekly-table tbody tr').length,history.weeks.length);
    date.value='2027-01-01';date.dispatchEvent(new w.Event('change'));assert.equal(date.value,'2026-01-02');
    const one={createdAt:'2026-10-18',challenges:[{startDate:'2026-10-18'}],now:'2026-10-18'};renderSobrietyDetails(d,calculateSobrietyRate(one),{history:calculateSobrietyHistory(one)});
    assert(d.getElementById('sobrietyTrendSlider').disabled);assert(!d.querySelector('.sobriety-trend-line').getAttribute('points').includes('NaN'));
});
test('popup reuses history between clock ticks, rebuilds for changed source records and clears history on account/loading changes',async t=>{
    const dom=new JSDOM(html,{runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,d=w.document;t.after(()=>w.close());
    let builds=0,renders=0;Object.assign(w,{userId:'a',auth:{currentUser:{uid:'a'}},cravingHistoryStatus:'ready',sobrietyDailyStatus:'ready',sobrietyControlStatus:'ready',
        hrEl:id=>d.getElementById(id),getCurrentSobrietyRate(){},calculateSobrietyHistory:()=>{builds++;return{daily:[],weeks:[]};},
        renderSobrietyDetails:(doc,result,state)=>{renders++;w.lastHistory=state.history;},sobrietyCache:{uid:'a',result:{totalDays:10,percent:90},input:{}}});
    const start=html.indexOf("    let sobrietyDetailsKey = ''"),end=html.indexOf('    window.openSobrietyRate',start);w.eval(html.slice(start,end));
    w.refreshSobrietyDetails();assert.equal(builds,0,'closed popup does not calculate histories');
    d.getElementById('sobrietyRateModal').hidden=false;w.refreshSobrietyDetails();w.refreshSobrietyDetails();assert.equal(builds,1);assert.equal(renders,1);
    w.sobrietyCache={uid:'a',result:{totalDays:10,percent:90},input:{}};w.refreshSobrietyDetails();assert.equal(builds,2);assert.equal(renders,2);
    w.sobrietyDailyStatus='loading';w.refreshSobrietyDetails();assert.equal(w.lastHistory,null);assert.equal(builds,2);
    w.sobrietyDailyStatus='ready';w.auth.currentUser={uid:'b'};w.refreshSobrietyDetails();assert.equal(w.lastHistory,null);
});
test('photo actions sit immediately after diary save form and retain their own non-submit controls',()=>{
    const dom=new JSDOM(html),d=dom.window.document,actions=d.getElementById('diagnosisPhotoActions');
    assert.equal(actions.previousElementSibling.tagName,'FORM');assert(actions.previousElementSibling.contains(d.getElementById('diagnosisDiarySave')));
    assert(!d.querySelector('.diagnosis-photo-section').contains(actions));assert.equal(d.getElementById('diagnosisPhotoCamera').type,'button');assert.equal(d.getElementById('diagnosisPhotoAdd').type,'button');
    assert.equal(d.querySelector('.sobriety-comparison'),null);dom.window.close();
});
