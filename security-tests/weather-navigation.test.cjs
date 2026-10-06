const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const modulePromise=import(pathToFileURL(path.join(root,'daily-health-tools.js')));
const now=Date.parse('2026-09-30T16:00:00Z'); // October 1 in Korea.
function data(){return{utc_offset_seconds:32400,current:{time:'2026-10-01T01:00',temperature_2m:20,weather_code:0},daily:{time:['2026-09-30','2026-10-01','2026-10-02'],temperature_2m_min:[12,14,0],temperature_2m_max:[25,27,21],weather_code:[3,0,61]}};}
function fixture(t){const dom=new JSDOM(`<button data-weather-open>오늘 날씨</button>${source.match(/<dialog id="todayWeatherModal"[\s\S]*?<\/dialog>/)[0]}`,{url:'https://fixture.invalid'});t.after(()=>dom.window.close());const w=dom.window,d=w.document,el=id=>d.getElementById(id),dialog=el('todayWeatherModal');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new w.Event('close'));};return{w,d,el,dialog};}
const place={key:'suji',label:'용인 수지·광교',lat:37.32,lon:127.09};
const response=value=>({ok:true,json:async()=>value});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('selected weather dates cross month boundaries without showing today’s temperature on other dates',async t=>{
    const{parseWeatherDay,installTodayWeather}=await modulePromise;
    assert.equal(parseWeatherDay(data(),'2026-10-02',now).temperature,null);
    assert.equal(parseWeatherDay(data(),'2026-10-02',now).min,0);
    const{w,d,el}=fixture(t);let requests=0;
    const api=installTodayWeather({document:d,window:w,now:()=>now,fetch:async url=>{requests++;const q=new URL(url).searchParams;assert.equal(q.get('past_days'),'7');assert.equal(q.get('forecast_days'),'16');return response(data());}});
    await api.lookup(place);const header=d.querySelector('[data-weather-open]').textContent;
    assert.match(el('weatherDayLabel').textContent,/10월 1일.*오늘/);
    el('weatherPrevious').click();assert.match(el('weatherDayLabel').textContent,/9월 30일/);assert(el('weatherCurrent').hidden);assert.match(el('weatherCondition').textContent,/당시 예보/);assert(el('weatherPrevious').disabled);
    api.navigate(-1);assert.match(el('weatherDayLabel').textContent,/9월 30일/);assert.match(el('weatherStatus').textContent,/끝/);
    el('weatherToday').click();assert(!el('weatherCurrent').hidden);assert.match(el('weatherCurrent').textContent,/20.0/);
    el('weatherNext').click();assert.match(el('weatherDayLabel').textContent,/10월 2일/);assert(el('weatherNext').disabled);assert.equal(el('weatherMin').textContent,'0.0°C');
    assert.equal(d.querySelector('[data-weather-open]').textContent,header);assert.equal(requests,1,'date browsing uses the same forecast');
    d.querySelector('[data-weather-open]').click();assert.match(el('weatherDayLabel').textContent,/오늘/);
});

test('missing daily values do not reuse another day; refresh preserves the selected date and expired data cannot swipe',async t=>{
    const{installTodayWeather}=await modulePromise;const{w,d,el}=fixture(t);let time=now,requests=0;
    const values=data();values.daily.temperature_2m_min[2]=null;
    const api=installTodayWeather({document:d,window:w,now:()=>time,fetch:async()=>{requests++;return response(values);}});
    await api.lookup(place);api.navigate(1);assert.equal(el('weatherMin').textContent,'—');assert.match(el('weatherCondition').textContent,/자료가 없습니다/);
    values.daily.temperature_2m_min[2]=5;el('weatherRefresh').click();await tick();
    assert.match(el('weatherDayLabel').textContent,/10월 2일/);assert.equal(el('weatherMin').textContent,'5.0°C');assert.equal(requests,2);
    time+=86400000;api.navigate(-1);assert.match(el('weatherDayLabel').textContent,/10월 2일/,'expired forecast does not pretend to be current');
});

test('weather swipe supports both directions, ignores scrolling, cancelled and multi-touch gestures, and leaves buttons tappable',async t=>{
    const{installWeatherSwipe}=await modulePromise;const{w,d,dialog,el}=fixture(t);let time=0,enabled=true;const moves=[];
    installWeatherSwipe({element:dialog,window:w,navigate:n=>moves.push(n),enabled:()=>enabled,now:()=>time});
    const surface=el('weatherCondition');
    function pointer(type,x,y,extra={},target=surface){const event=new w.Event(type,{bubbles:true,cancelable:true});for(const[k,v]of Object.entries({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,...extra}))Object.defineProperty(event,k,{value:v});target.dispatchEvent(event);}
    function swipe(x1,y1,x2,y2){time=0;pointer('pointerdown',x1,y1);time=100;pointer('pointermove',x2,y2);time=200;pointer('pointerup',x2,y2);}
    swipe(250,100,90,105);swipe(90,100,250,105);assert.deepEqual(moves,[1,-1]);
    swipe(100,100,105,240);swipe(100,100,160,175);swipe(100,100,125,100);assert.deepEqual(moves,[1,-1]);
    time=0;pointer('pointerdown',250,100);time=700;pointer('pointermove',90,100);pointer('pointerup',90,100);assert.equal(moves.length,2);
    time=0;pointer('pointerdown',250,100);time=100;pointer('pointermove',90,100);pointer('pointercancel',90,100);pointer('pointerup',90,100);assert.equal(moves.length,2);
    time=0;pointer('pointerdown',250,100);pointer('pointerdown',270,110,{pointerId:2,isPrimary:false},d.body);pointer('pointermove',90,100);pointer('pointerup',90,100);assert.equal(moves.length,2);
    swipe(250,100,90,100);let clicked=0;el('weatherNext').addEventListener('click',()=>clicked++);
    pointer('pointerdown',90,100,{},el('weatherNext'));el('weatherNext').dispatchEvent(new w.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(clicked,1,'a new button tap is not swallowed after a swipe');
    enabled=false;swipe(250,100,90,100);assert.deepEqual(moves,[1,-1,1]);
});

test('risk overlap advances inside the correct two-hour block, switches blocks and resets at midnight without rebuilding cells',async t=>{
    const{renderFailureTimeRisk,updateFailureTimeProgress}=await modulePromise;
    const dom=new JSDOM('<div id="subFill"></div><div id="subFailureSegments"></div><p id="subFailureSummary"></p>');t.after(()=>dom.window.close());const d=dom.window.document;
    renderFailureTimeRisk(d,[{status:'failed',endDate:new Date(2026,8,20,20)}]);const cells=[...d.getElementById('subFailureSegments').children];
    updateFailureTimeProgress(d,new Date(2026,9,6,21,0,0));assert(cells[10].classList.contains('is-peak'));assert(cells[10].classList.contains('is-current'));assert.equal(cells[10].style.getPropertyValue('--clock-fill'),'50%');assert.equal(d.getElementById('subFill').style.width,'87.5%');
    updateFailureTimeProgress(d,new Date(2026,9,6,21,0,1));assert(Number.parseFloat(cells[10].style.getPropertyValue('--clock-fill'))>50);assert.equal(d.getElementById('subFailureSegments').children[10],cells[10]);
    updateFailureTimeProgress(d,new Date(2026,9,6,22));assert(!cells[10].classList.contains('is-current'));assert(cells[11].classList.contains('is-current'));
    updateFailureTimeProgress(d,new Date(2026,9,7,0));assert(cells[0].classList.contains('is-current'));assert.equal(d.getElementById('subFill').style.width,'0%');assert.equal(d.querySelectorAll('.is-current').length,1);
});
