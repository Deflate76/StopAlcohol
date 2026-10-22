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
test('30/60/90-day rates include each date, expire older drinks and use only elapsed Korean calendar days',async()=>{
    const {calculateSobrietyHistory}=await mod('sobriety-metrics.js');
    const day=index=>new Date(Date.parse('2023-12-31T00:00:00Z')+index*86400000).toISOString().slice(0,10);
    const drinkIndices=[0,29,30,59,60,89,90,120];
    const input={createdAt:'2023-12-30',challenges:[{startDate:day(0)},
        {startDate:day(1),endDate:day(30),status:'failed',failAmount:2}],now:day(120),
        dailyLogs:Object.fromEntries([...drinkIndices,-1,121].map(i=>[day(i),{alcohol:2}])),
        controlSessions:[{drinksList:[{alcoholGrams:2,drinkStartedAt:day(29)+'T15:00:00Z'}]}]};
    const {daily}=calculateSobrietyHistory(input);assert.equal(daily.length,121);assert.equal(daily[60].date,'2024-02-29');
    daily.forEach((row,index)=>{
        for(const n of [30,60,90]){
            const first=Math.max(0,index-n+1),drinks=drinkIndices.filter(i=>i>=first&&i<=index).length,total=index-first+1;
            assert.deepEqual(row.rolling[n],{startDate:day(first),totalDays:total,drinkingDays:drinks,soberDays:total-drinks,percent:(total-drinks)/total*100},`day ${index}, window ${n}`);
        }
    });
    for(const n of [30,60,90]){
        const history=calculateSobrietyHistory({...input,challenges:[{startDate:day(0)}],controlSessions:[],dailyLogs:{[day(0)]:{alcohol:1}}});
        assert.equal(history.daily[n-1].rolling[n].drinkingDays,1);
        assert.equal(history.daily[n].rolling[n].drinkingDays,0,'N+1th day drops first drinking day');
        assert.equal(history.daily[n].rolling[n].percent,100);
        assert(history.daily[n].percent<100,'cumulative still includes old drink');
    }
});
test('trend date/slider/range controls expose exact values and weekly table paginates all weeks',async t=>{
    const {calculateSobrietyHistory,calculateSobrietyRate}=await mod('sobriety-metrics.js'),{renderSobrietyDetails}=await mod('sobriety-details.js');
    const dom=new JSDOM(html),w=dom.window,d=w.document;t.after(()=>w.close());
    const input={createdAt:'2026-01-01',challenges:[{startDate:'2026-01-01'}],dailyLogs:{'2026-01-01':{alcohol:1},'2026-10-10':{alcohol:1}},now:'2026-10-18'};
    const history=calculateSobrietyHistory(input);renderSobrietyDetails(d,calculateSobrietyRate(input),{history});
    assert.equal(d.querySelectorAll('.sobriety-trend-line').length,4);
    assert.equal(d.querySelector('.sobriety-trend-line').getAttribute('points').split(' ').length,history.daily.length-1);
    assert.equal(d.querySelector('.sobriety-trend-chart').dataset.startDate,'2026-01-02');
    for(const n of [30,60,90]){
        const line=d.querySelector(`.sobriety-trend-line[data-series="${n}"]`);
        assert.notEqual(line.getAttribute('points'),d.querySelector('.sobriety-trend-line').getAttribute('points'));
        assert.match(d.querySelector(`[data-series-value="${n}"]`).textContent,new RegExp(history.daily.at(-1).rolling[n].percent.toFixed(2).replace('.','\\.')+'%'));
        const before=d.querySelector(`[data-series-value="${n}"]`).textContent;
        d.querySelector(`[data-period="${n}"]`).click();
        assert.equal(d.querySelector('.sobriety-trend-line').getAttribute('points').split(' ').length,n);
        assert.equal(d.querySelector(`[data-series-value="${n}"]`).textContent,before,'display range must not reset calculation start');
    }
    d.querySelector('[data-period="30"]').click();
    const date=d.getElementById('sobrietyTrendDate');date.value='2026-01-01';date.dispatchEvent(new w.Event('change'));
    assert.equal(d.querySelector('[data-period="all"]').getAttribute('aria-pressed'),'true');assert.match(d.getElementById('sobrietyTrendValue').textContent,/0.00%/);
    const slider=d.getElementById('sobrietyTrendSlider');slider.value='1';slider.dispatchEvent(new w.Event('input'));assert.equal(date.value,'2026-01-02');assert.match(slider.getAttribute('aria-valuetext'),/50.00%/);
    assert.match(d.querySelector('[data-series-value="90"]').textContent,/90일 중 2일 집계/);
    const toggle=d.querySelector('.sobriety-trend-legend [data-series="30"]');toggle.click();
    assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(d.querySelector('.sobriety-trend-line[data-series="30"]'),null);
    assert.equal(date.value,'2026-01-02');assert(d.querySelector('[data-series-value="30"]'),'exact values remain available when a line is hidden');
    toggle.click();assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(d.querySelectorAll('.sobriety-trend-line').length,4);
    for(const button of d.querySelectorAll('.sobriety-trend-legend button'))button.click();
    for(const button of d.querySelectorAll('.sobriety-reference-legend [aria-pressed="true"]'))button.click();
    assert.equal(d.querySelectorAll('.sobriety-trend-line').length,0);assert.match(d.querySelector('.sobriety-trend-chart').textContent,/범례를 눌러/);
    d.querySelector('.sobriety-trend-legend [data-series="all"]').click();assert.equal(d.querySelectorAll('.sobriety-trend-line').length,1);
    assert.equal(d.querySelectorAll('.sobriety-weekly-table tbody tr').length,12);
    const more=d.querySelector('.sobriety-weekly>button');while(!more.hidden)more.click();assert.equal(d.querySelectorAll('.sobriety-weekly-table tbody tr').length,history.weeks.length);
    date.value='2027-01-01';date.dispatchEvent(new w.Event('change'));assert.equal(date.value,'2026-01-02');
    const one={createdAt:'2026-10-18',challenges:[{startDate:'2026-10-18'}],now:'2026-10-18'};renderSobrietyDetails(d,calculateSobrietyRate(one),{history:calculateSobrietyHistory(one)});
    assert(d.getElementById('sobrietyTrendSlider').disabled);
    for(const line of d.querySelectorAll('.sobriety-trend-line'))assert(!line.getAttribute('points').includes('NaN'));
    assert.equal(d.querySelectorAll('.sobriety-trend-point').length,4);
    assert.match(d.querySelector('[data-series-value="30"]').textContent,/30일 중 1일 집계/);
});
test('frequency comparison lines use sober-day ratios and stay fixed across periods and recorded dates',async t=>{
    const {calculateSobrietyHistory,calculateSobrietyRate}=await mod('sobriety-metrics.js'),{renderSobrietyDetails}=await mod('sobriety-details.js');
    const dom=new JSDOM('<div id="sobrietyRateDetails"></div>'),d=dom.window.document;t.after(()=>dom.window.close());
    const input={createdAt:'2026-01-01',challenges:[{startDate:'2026-01-01'}],now:'2026-10-22',dailyLogs:{'2026-01-01':{alcohol:1},'2026-10-21':{alcohol:1}}};
    const history=calculateSobrietyHistory(input),before=JSON.stringify(history);
    renderSobrietyDetails(d,calculateSobrietyRate(input),{history});
    const cases=[['monthly1',29,30],['weekly1',6,7],['weekly2',5,7],['weekly3',4,7]];
    assert.equal(d.querySelectorAll('.sobriety-reference-line').length,2);
    for(const [key,sober,total] of cases){
        const toggle=d.querySelector(`.sobriety-reference-legend [data-reference="${key}"]`);
        assert.match(toggle.textContent,new RegExp((sober/total*100).toFixed(2).replace('.','\\.')+'%'));
        if(toggle.getAttribute('aria-pressed')==='false')toggle.click();
    }
    for(const period of ['30','60','90','all']){
        d.querySelector(`[data-period="${period}"]`).click();
        for(const [key,sober,total] of cases){
            const line=d.querySelector(`.sobriety-reference-line[data-reference="${key}"]`);
            assert.equal(line.getAttribute('y1'),line.getAttribute('y2'),'comparison is a constant rate, not a generated drinking diary');
            assert(Math.abs(Number(line.getAttribute('y1'))-(173-sober/total*155))<1e-8);
            assert.equal(line.getAttribute('x1'),'42');assert.equal(line.getAttribute('x2'),'405');
            assert.match(line.textContent,new RegExp(`금주 ${sober}/${total}일`));
        }
    }
    assert.equal(JSON.stringify(history),before,'examples cannot alter user rates or weekly records');
    assert.match(d.querySelector('.sobriety-reference-info').textContent,/성인 평균 금주율이나 권장 음주량이 아닙니다/);
    assert.match(d.getElementById('sobrietyTrendDescription').textContent,/음주 빈도별 비교 예시/);
});
test('comparison toggles preserve date selection and own curves, and disappear with cleared user data',async t=>{
    const {calculateSobrietyHistory,calculateSobrietyRate}=await mod('sobriety-metrics.js'),{renderSobrietyDetails}=await mod('sobriety-details.js');
    const dom=new JSDOM('<div id="sobrietyRateDetails"></div>'),w=dom.window,d=w.document;t.after(()=>w.close());
    const input={createdAt:'2026-10-01',challenges:[{startDate:'2026-10-01'}],now:'2026-10-22'};
    renderSobrietyDetails(d,calculateSobrietyRate(input),{history:calculateSobrietyHistory(input)});
    const date=d.getElementById('sobrietyTrendDate');date.value='2026-10-10';date.dispatchEvent(new w.Event('change'));
    const values=d.getElementById('sobrietyTrendValue').textContent,points=d.querySelector('.sobriety-trend-line').getAttribute('points');
    const toggle=d.querySelector('.sobriety-reference-legend [data-reference="monthly1"]');toggle.click();
    assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(d.querySelector('.sobriety-reference-line[data-reference="monthly1"]'),null);
    assert.equal(date.value,'2026-10-10');assert.equal(d.getElementById('sobrietyTrendValue').textContent,values);
    assert.equal(d.querySelector('.sobriety-trend-line').getAttribute('points'),points);
    toggle.click();assert.equal(d.querySelectorAll('.sobriety-reference-line').length,2);
    const one={...input,now:'2026-10-01'};renderSobrietyDetails(d,calculateSobrietyRate(one),{history:calculateSobrietyHistory(one)});
    assert.equal(d.querySelectorAll('.sobriety-reference-line').length,2);assert(d.getElementById('sobrietyTrendSlider').disabled);
    renderSobrietyDetails(d,null,{loading:true});assert.equal(d.querySelector('.sobriety-reference-legend'),null);assert.equal(d.querySelector('.sobriety-trend-chart'),null);
});
test('rate headline uses two decimals and unrounded Korean previous-day rates for signed percentage-point changes',async t=>{
    const {calculateSobrietyHistory,calculateSobrietyRate}=await mod('sobriety-metrics.js'),{renderSobrietyDetails}=await mod('sobriety-details.js');
    const dom=new JSDOM('<div id="sobrietyRateDetails"></div>'),d=dom.window.document;t.after(()=>dom.window.close());
    const input={createdAt:'2026-10-01',challenges:[{startDate:'2026-10-01'}],now:'2026-10-03'};
    for(const [logs,number,change,direction] of [
        [{'2026-10-01':{alcohol:1}},'66.67%','(전날 +16.67%p)','up'],
        [{'2026-10-03':{alcohol:1}},'66.67%','(전날 -33.33%p)','down'],
        [{},'100.00%','(전날 0.00%p)','same'],
        [Object.fromEntries([1,2,3].map(day=>[`2026-10-0${day}`,{alcohol:1}])),'0.00%','(전날 0.00%p)','same']
    ]){
        const data={...input,dailyLogs:logs};renderSobrietyDetails(d,calculateSobrietyRate(data),{history:calculateSobrietyHistory(data)});
        assert.equal(d.querySelector('.sobriety-rate-number').textContent,number);
        assert.equal(d.querySelector('.sobriety-rate-change').textContent,change);
        assert.equal(d.querySelector('.sobriety-rate-change').dataset.direction,direction);
        assert.equal(parseFloat(d.querySelector('.sobriety-rate-bar>span').style.width).toFixed(2),number.slice(0,-1));
        assert(!d.querySelector('.sobriety-rate-formula').textContent.includes('→'));
    }
    const midnight={createdAt:'2026-10-20T00:00:00+09:00',challenges:[{startDate:'2026-10-20'}],
        controlSessions:[{drinksList:[{alcoholGrams:10,drinkStartedAt:'2026-10-20T14:59:00Z'}]}],now:'2026-10-20T15:00:00Z'};
    renderSobrietyDetails(d,calculateSobrietyRate(midnight),{history:calculateSobrietyHistory(midnight)});
    assert.equal(d.querySelector('.sobriety-rate-number').textContent,'50.00%');
    assert.equal(d.querySelector('.sobriety-rate-change').textContent,'(전날 +50.00%p)');
    const first={...input,now:'2026-10-01'};renderSobrietyDetails(d,calculateSobrietyRate(first),{history:calculateSobrietyHistory(first)});
    assert.equal(d.querySelector('.sobriety-rate-change').textContent,'(첫 기록)');
    renderSobrietyDetails(d,calculateSobrietyRate(input));assert.equal(d.querySelector('.sobriety-rate-change').textContent,'(전날 기록 없음)');
});
test('default chart starts at the first nonzero rate without removing initial drinking days from totals or date inspection',async t=>{
    const {calculateSobrietyHistory,calculateSobrietyRate}=await mod('sobriety-metrics.js'),{renderSobrietyDetails}=await mod('sobriety-details.js');
    const dom=new JSDOM('<div id="sobrietyRateDetails"></div>'),w=dom.window,d=w.document;t.after(()=>w.close());
    const input={createdAt:'2026-10-01',challenges:[{startDate:'2026-10-01'}],now:'2026-10-05',dailyLogs:{'2026-10-01':{alcohol:1},'2026-10-02':{alcohol:1},'2026-10-03':{alcohol:1}}};
    const history=calculateSobrietyHistory(input),snapshot=JSON.stringify(history);
    renderSobrietyDetails(d,calculateSobrietyRate(input),{history});
    const points=()=>d.querySelector('.sobriety-trend-line').getAttribute('points').split(' ');
    assert.equal(d.querySelector('.sobriety-trend-chart').dataset.startDate,'2026-10-04');
    assert.equal(points().length,2);assert.equal(Number(points()[0].split(',')[1]),134.25,'first point is the actual 25%, not a zero anchor');
    assert.equal(d.querySelector('.sobriety-rate-number').textContent,'40.00%');
    assert.match(d.querySelector('.sobriety-rate-formula').textContent,/5 − 3/);
    assert.equal(JSON.stringify(history),snapshot,'chart never changes calculations or weekly records');
    assert.match(d.querySelector('.sobriety-weekly-table tbody').textContent,/3일/);
    const date=d.getElementById('sobrietyTrendDate');date.value='2026-10-01';date.dispatchEvent(new w.Event('change'));
    assert.equal(date.value,'2026-10-01');assert.equal(points().length,5);assert.match(d.getElementById('sobrietyTrendValue').textContent,/0.00%/);
    d.querySelector('[data-period="all"]').click();assert.equal(points().length,2);
    const zeros={...input,now:'2026-10-03'};renderSobrietyDetails(d,calculateSobrietyRate(zeros),{history:calculateSobrietyHistory(zeros)});
    assert.equal(points().length,3);assert(points().every(point=>Number(point.split(',')[1])===173),'all-zero recorded history remains visible');
    const sparse={...input,dailyLogs:{'2026-10-01':{alcohol:1}}},partial=calculateSobrietyHistory(sparse);partial.daily=partial.daily.slice(3);
    renderSobrietyDetails(d,calculateSobrietyRate(sparse),{history:partial});
    assert.equal(points().length,2);assert.equal(Number(points()[0].split(',')[1]),56.75,'first available value of 75% begins at its own height');
});
test('later genuine zero rates in rolling windows are still drawn',async t=>{
    const {calculateSobrietyHistory,calculateSobrietyRate}=await mod('sobriety-metrics.js'),{renderSobrietyDetails}=await mod('sobriety-details.js');
    const dom=new JSDOM('<div id="sobrietyRateDetails"></div>'),d=dom.window.document;t.after(()=>dom.window.close());
    const input={createdAt:'2026-10-01',challenges:[{startDate:'2026-10-01'}],now:'2026-10-31',dailyLogs:Object.fromEntries(Array.from({length:30},(_,i)=>[`2026-10-${String(i+2).padStart(2,'0')}`,{alcohol:1}]))};
    renderSobrietyDetails(d,calculateSobrietyRate(input),{history:calculateSobrietyHistory(input)});
    const points=d.querySelector('.sobriety-trend-line[data-series="30"]').getAttribute('points').split(' ');
    assert.equal(points.length,31);assert.equal(Number(points.at(-1).split(',')[1]),173);
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
