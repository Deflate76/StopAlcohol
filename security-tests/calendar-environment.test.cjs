const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const calendar=import(pathToFileURL(path.join(root,'calendar-environment.js')));
const korean=import(pathToFileURL(path.join(root,'korean-calendar.js')));
const now=Date.parse('2026-10-04T12:00:00+09:00');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const forecast=(min=12)=>({utc_offset_seconds:32400,daily:{time:['2026-10-04','2026-10-05'],
    weather_code:[0,63],temperature_2m_min:[min,min+1],temperature_2m_max:[24,22]}});
const response=data=>({ok:true,json:async()=>data});

test('Korean lunar holidays, replacement rules, one-off days and 2026 amendments',async()=>{
    const {getKoreanHolidays}=await korean;
    const names=(year,key)=>getKoreanHolidays(year).dates.get(key)?.map(h=>h.name).join('·');
    assert.equal(getKoreanHolidays(2026).lunarSupported,true);
    assert.equal(names(2026,'2026-02-17'),'설날');
    assert.equal(names(2026,'2026-02-16'),'설날 연휴');
    assert.equal(names(2026,'2026-05-24'),'부처님오신날');
    assert.match(names(2026,'2026-05-25'),/대체공휴일/);
    assert.equal(names(2026,'2026-09-25'),'추석');
    assert.equal(names(2026,'2026-09-28'),undefined,'Saturday Chuseok does not earn a replacement');
    assert.equal(names(2026,'2026-05-01'),'노동절');
    assert.equal(names(2026,'2026-07-17'),'제헌절');
    assert.equal(names(2025,'2025-05-01'),undefined);
    assert.equal(names(2025,'2025-07-17'),undefined);
    assert.match(names(2027,'2027-05-03'),/노동절/);
    assert.match(names(2027,'2027-07-19'),/제헌절/);
    assert.match(names(2027,'2027-02-09'),/설날/);
    assert.equal(names(2026,'2026-06-08'),undefined,'Memorial Day has no replacement');
    assert.equal(names(2026,'2026-06-03'),'지방선거');
    assert.equal(names(2024,'2024-10-01'),'국군의 날');
    assert.equal(names(2025,'2025-01-27'),'임시공휴일');
    assert.equal(names(2025,'2025-06-03'),'대통령선거');
    assert.match(names(2025,'2025-05-05'),/어린이날·부처님오신날/);
    assert.match(names(2025,'2025-05-06'),/대체공휴일/);
    assert.equal(names(2025,'2025-05-07'),undefined,'two holidays on one date get one replacement');
    assert.equal(names(2021,'2021-03-02'),undefined,'no retroactive expanded replacements');
    assert.match(names(2021,'2021-08-16'),/광복절/);
    assert.equal(getKoreanHolidays(1900).supported,false);
});

test('Korean civil date and astronomy do not depend on the device timezone',async()=>{
    const {koreanDateKey,shiftCalendarDate}=await korean;
    const {calendarAstronomy}=await calendar;
    assert.equal(koreanDateKey(Date.parse('2026-10-03T15:01:00Z')),'2026-10-04');
    assert.equal(shiftCalendarDate('2028-02-28',1),'2028-02-29');
    assert.equal(shiftCalendarDate('2026-12-31',1),'2027-01-01');
    const winter=calendarAstronomy('2026-01-01',37.57,126.98),summer=calendarAstronomy('2026-06-21',37.57,126.98);
    assert(winter.sunrise>='07:45'&&winter.sunrise<='07:50');
    assert(summer.sunrise>='05:09'&&summer.sunrise<='05:15');
    assert(summer.sunset>='19:54'&&summer.sunset<='20:00');
    const busan=calendarAstronomy('2026-10-04',35.18,129.08),seoul=calendarAstronomy('2026-10-04',37.57,126.98);
    assert.notEqual(busan.sunrise,seoul.sunrise);
    const full=calendarAstronomy('2026-09-25',37.57,126.98).moon;
    assert.equal(full.icon,'🌕');assert(full.illumination>=95);
    assert.equal(calendarAstronomy('2026-02-30',37,127),null);
    assert.equal(calendarAstronomy('2026-10-04',NaN,127),null);
});

test('forecast data is limited to Korean dates and never turns missing temperatures into zero',async()=>{
    const {parseCalendarForecast}=await calendar;
    const data=forecast(0);data.daily.time.push('2026-11-20','2026-10-03');
    const parsed=parseCalendarForecast(data,'2026-10-04');
    assert.equal(parsed.get('2026-10-04').min,0);
    assert.equal(parsed.size,2);
    data.daily.temperature_2m_min[0]=null;
    assert.equal(parseCalendarForecast(data,'2026-10-04').get('2026-10-04').min,null);
    assert.throws(()=>parseCalendarForecast({...data,utc_offset_seconds:0},'2026-10-04'));
    assert.throws(()=>parseCalendarForecast({utc_offset_seconds:32400,daily:{time:[]}},'2026-10-04'));
});

async function fixture(t,fetcher,options={}) {
    const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const panel=html.match(/<section class="cal-environment-panel"[\s\S]*?<\/section>/)[0];
    const dom=new JSDOM(`<div id="calendarModal">${panel}<div id="calendarDaysGrid"></div></div>`,{url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());
    const doc=dom.window.document,grid=doc.getElementById('calendarDaysGrid');
    const requests=[];
    const setDates=dates=>{grid.innerHTML=dates.map(date=>`<div class="cal-day cal-range-marker" data-date="${date}" aria-label="${date}, 진행중, 건강기록 추가" role="button" tabindex="0"><span class="cal-day-number">${Number(date.slice(-2))}</span><span class="cal-range-badge">진행중</span></div>`).join('');};
    setDates(['2026-10-03','2026-10-04','2026-10-05','2026-10-20']);
    options.setup?.(dom.window);
    const {installCalendarEnvironment}=await calendar;
    const ui=installCalendarEnvironment({document:doc,window:dom.window,now:()=>now,fetch:async(url,init)=>{
        requests.push({url,init});return fetcher(url,init);
    }});
    return {ui,doc,win:dom.window,requests,setDates,cell:date=>grid.querySelector(`[data-date="${date}"]`)};
}

test('calendar renders all layers, retains record actions/accessible schedules and reuses cached forecasts',async t=>{
    const deferred=pending();
    const f=await fixture(t,()=>deferred.promise);
    let clicks=0;f.cell('2026-10-04').addEventListener('click',()=>clicks++);
    const loading=f.ui.render(2026,9);
    const cell=f.cell('2026-10-04');
    cell.dataset.scheduleBaseLabel=cell.getAttribute('aria-label');
    cell.setAttribute('aria-label',cell.dataset.scheduleBaseLabel+', 일정 2개');
    deferred.resolve(response(forecast()));await loading;
    assert.equal(f.cell('2026-10-03').querySelector('.cal-holiday-name').textContent,'개천절');
    assert.equal(f.cell('2026-10-05').querySelector('.cal-holiday-name').textContent,'대체공휴일');
    assert.match(cell.textContent,/12°\/24°/);assert.equal(cell.querySelectorAll('.cal-environment').length,1);
    assert.match(cell.getAttribute('aria-label'),/진행중.*일출.*일정 2개/);
    cell.click();assert.equal(clicks,1);
    assert.match(f.cell('2026-10-20').textContent,/예보 전/);
    await f.ui.render(2026,9);assert.equal(f.requests.length,1);
    assert.equal(cell.getAttribute('aria-label').match(/일출/g).length,1,'no repeated accessible annotations');
    assert.equal(cell.getAttribute('aria-label').match(/일정 2개/g).length,1);
    const url=new URL(f.requests[0].url);
    assert.equal(url.searchParams.get('timezone'),'Asia/Seoul');
    assert.equal(url.searchParams.get('forecast_days'),'16');
    assert.equal(f.requests[0].init.credentials,'omit');
    assert.equal(f.requests[0].init.referrerPolicy,'no-referrer');
    assert.equal([...url.searchParams.keys()].length,6,'only coordinates and forecast settings are transmitted');
    f.setDates(['2026-01-01']);await f.ui.render(2026,0);
    assert.equal(f.requests.length,1);assert(f.cell('2026-01-01').querySelector('.cal-sunrise'));
});

test('region changes ignore late responses and still work without local storage',async t=>{
    const older=pending(),newer=pending();let count=0;
    const f=await fixture(t,()=>++count===1?older.promise:newer.promise,{setup:win=>{
        Object.defineProperty(win,'localStorage',{get(){throw new Error('Disabled storage');}});
    }});
    const first=f.ui.render(2026,9);
    const select=f.doc.getElementById('calEnvironmentRegion');select.value='busan';select.dispatchEvent(new f.win.Event('change'));
    newer.resolve(response(forecast(10)));await tick();
    older.resolve(response(forecast(1)));await first;
    assert.match(f.cell('2026-10-04').textContent,/10°\/24°/);
    assert.match(f.doc.getElementById('calEnvironmentStatus').textContent,/부산/);
    assert.equal(f.requests[0].init.signal.aborted,true);
    await f.ui.render(2026,9);assert.equal(select.value,'busan');
});

test('network failure preserves holidays and astronomy and allows a successful retry',async t=>{
    let offline=true;
    const f=await fixture(t,()=>{if(offline)throw new Error('Offline');return response(forecast());});
    await f.ui.render(2026,9);
    assert.match(f.doc.getElementById('calEnvironmentStatus').textContent,/불러오지/);
    assert(f.cell('2026-10-05').querySelector('.cal-holiday-name'));
    assert(f.cell('2026-10-04').querySelector('.cal-sunset'));
    assert.match(f.cell('2026-10-04').textContent,/조회 실패/);
    offline=false;f.doc.getElementById('calEnvironmentRefresh').click();await tick();
    assert.match(f.cell('2026-10-04').textContent,/12°\/24°/);
    assert.equal(f.doc.getElementById('calEnvironmentStatus').classList.contains('is-error'),false);
});
