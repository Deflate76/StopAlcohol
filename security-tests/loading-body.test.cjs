const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const loading=import(pathToFileURL(path.join(root,'app-loading.js')));
const health=import(pathToFileURL(path.join(root,'daily-health-tools.js')));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
const now=new Date(2026,9,8,12).getTime();
const state=(hour,values={stress:8})=>({type:'state',timestamp:new Date(2026,9,7,hour).getTime(),...values});

test('body score reverses symptom severity, keeps good mood positive, and excludes untouched/invalid values',async()=>{
    const {bodyStateScore:score}=await health;
    assert.equal(score(state(1,{stress:8,mood:2})).score,20);
    assert.equal(score(state(1,{mood:10,stress:0,fatigue:null})).score,100);
    assert.equal(score(state(1,{mood:0,stress:10})).score,0);
    assert.deepEqual(score(state(1,{stress:6,fatigue:99,mood:'0',hunger:null})),{score:40,fields:1});
    assert.equal(score({type:'state',mood:null}),null);
    assert.equal(score({...state(1),type:'eval'}),null);
});

test('body percentages use each time bin’s own denominator, override stale current records, and keep midnight boundaries',async()=>{
    const {bodyTimeStats}=await health;
    const stats=bodyTimeStats({currentId:'live',challenges:[{id:'old',cravings:[state(0),state(1,{stress:0}),state(23)]},{id:'live',cravings:[state(12)]}],cravings:[state(2,{stress:6}),state(2,{mood:10}),{...state(2),timestamp:now+1},{...state(2),timestamp:'2026-10-07'},{type:'state',timestamp:state(2).timestamp},null,{...state(12),type:'action'}]},now);
    assert.equal(stats.total,5);assert.equal(stats.low,3);assert.equal(stats.skipped,3);
    assert.deepEqual(stats.bins[0],{total:2,low:1,sum:120});
    assert.equal(stats.bins[1].low/stats.bins[1].total,.5);assert.equal(stats.bins[11].low/stats.bins[11].total,1);
    assert.equal(stats.bins[6].total,0);
});

test('body arrows show observed ratios/sample sizes and clear private values for loading/error/account reset',async t=>{
    const {renderBodyTimeRisk}=await health;
    const dom=new JSDOM('<div id="subBodyMarkers"></div><p id="subBodySummary"></p>');t.after(()=>dom.window.close());const d=dom.window.document;
    renderBodyTimeRisk(d,{cravings:[state(0),state(1,{stress:0}),state(23)]},{nowMs:now});
    const buttons=d.querySelectorAll('button');assert.deepEqual([...buttons].map(b=>b.textContent),['50%','100%']);
    buttons[0].click();assert.match(d.getElementById('subBodySummary').textContent,/00~02시.*2건 중.*1건 \(50%\).*60점/);
    const arrow=d.querySelector('.sub-body-arrow');assert.equal(arrow.style.top,'0px');assert.equal(arrow.style.height,'8px');
    for(const options of [{loading:true},{error:true},{}]) {renderBodyTimeRisk(d,{},options);assert(d.getElementById('subBodyMarkers').hidden);assert.equal(d.querySelectorAll('button').length,0);}
});

function frames(w) {
    let id=0;const callbacks=new Map();
    w.requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id;};w.cancelAnimationFrame=id=>callbacks.delete(id);
    return()=>{const queue=[...callbacks.values()];callbacks.clear();queue.forEach(fn=>fn());};
}
function extract(name){const start=source.indexOf(`    function ${name}(`);assert(start>=0);return source.slice(start,source.indexOf('\n    }',start)+6);}
async function startup(t) {
    const dom=new JSDOM(['appLoadingStatus','appLoadingRetry','displayArea','loginArea','setupArea','cravingCount'].map(id=>`<div id="${id}"></div>`).join(''),{url:'https://fixture.invalid',runScripts:'outside-only'});t.after(()=>dom.window.close());
    const w=dom.window,frame=frames(w),profile=pending(),active=pending(),never=pending(),calls=[];
    const {backgroundTask,loadHomeEssentials}=await loading;
    Object.assign(w,{backgroundTask,loadHomeEssentials,userId:null,userQuitDate:null,currentChallengeId:null,cravingData:[],allChallengesData:[],dailyLogsData:{},cravingHistoryStatus:'loading',homeLoadGeneration:0,userProfile:{},cautionDays:[],controlActivitySessions:[],totalCravingCount:0,unsubscribePosts:null,timerInterval:null,
        accountDeletion:{isDeleting:()=>false},dailyWisdom:{bindAccount(){},start(){calls.push('AI');return never.promise;}},recordSectionUI:{setActivityData(){},setSummary(){}},hrBindAccount:uid=>calls.push(`health:${uid}`),bindCommunityPreview(){},invalidateMainDaysContainerRender(){},renderFailureTimeRisk(){},renderCravingTimeRisk(){},renderBodyTimeRisk(){},updateGreetingUI(){},updatePushButtonState(){},openNicknameModal(){},refreshMainClock(){},refreshProgressCharts(){},refreshActivitySummaries(){},refreshPushTokenIfAlreadyGranted(){},syncSobrietyReminderSetting(){},updateCurrentChallengeSummary(){},
        APP_MODE:{CONTROL:'control',ABSTINENCE:'abstinence'},phrPhotoEntry:false,scheduleEntry:false,db:{},auth:{currentUser:{uid:'owner'}},onAuthStateChanged:(_,cb)=>{w.authCallback=cb;},
        doc:(_, ...parts)=>({path:parts.join('/')}),collection:(_, ...parts)=>({path:parts.join('/')}),where:(...args)=>args,query:(ref,...filters)=>({...ref,filters}),
        getDoc:()=>{calls.push('profile');return profile.promise;},getDocs:ref=>{if(ref.path.endsWith('/challenges')){calls.push('active');return active.promise;}calls.push(ref.path);return never.promise;},
        setDoc:()=>{calls.push('visit-write');return never.promise;},loadMotivationalStats:()=>{calls.push('history');return never.promise;},
        startApp:()=>{w.document.getElementById('displayArea').dataset.ready='true';calls.push('screen');}
    });
    w.eval(extract('startAccountBackground'));
    const start=source.indexOf('    onAuthStateChanged(auth, async (user) => {');const end=source.indexOf('\n    function refreshActivitySummaries',start);
    w.eval(source.slice(start,end));
    const resolve=()=>{profile.resolve({exists:()=>true,data:()=>({nickname:'사용자',activeMode:'abstinence'})});active.resolve({empty:false,docs:[{id:'live',data:()=>({startDate:'2026-10-01T09:00',cravings:[]})}]});};
    return{w,frame,calls,profile,active,resolve};
}

test('actual authentication path renders essential data in parallel without waiting for diaries, visits or AI',async t=>{
    const f=await startup(t),run=f.w.authCallback({uid:'owner'});
    assert(f.calls.includes('profile')&&f.calls.includes('active'),'both critical reads start together');
    assert(!f.calls.some(c=>c.includes('daily_logs')));f.resolve();await run;
    assert.equal(f.w.document.getElementById('displayArea').dataset.ready,'true');
    assert(!f.calls.includes('history')&&!f.calls.includes('visit-write'),'optional work starts after first paint');
    f.frame();await tick();f.frame();await tick();
    assert(f.calls.includes('history')&&f.calls.includes('visit-write')&&f.calls.includes('users/owner/daily_logs'));
    assert.equal(f.w.document.getElementById('displayArea').dataset.ready,'true','unresolved optional services do not hide the home screen');
});

test('late startup replies cannot display or request private data after an account changes',async t=>{
    const f=await startup(t),run=f.w.authCallback({uid:'owner'});f.w.auth.currentUser={uid:'other'};f.resolve();await run;
    f.frame();await tick();f.frame();await tick();
    assert(!f.calls.includes('screen'));assert(!f.calls.includes('health:owner'));assert(!f.calls.includes('history'));
});

test('background paint queue cancels stale account work and renders after two frames',async t=>{
    const {backgroundTask}=await loading,dom=new JSDOM('');t.after(()=>dom.window.close());const frame=frames(dom.window);let valid=true,count=0;
    const task=backgroundTask(()=>count++,{win:dom.window,valid:()=>valid});assert.equal(count,0);frame();await tick();assert.equal(count,0);valid=false;frame();await task;assert.equal(count,0);
});

test('public weather cache survives a reload, expires after 20 minutes and does not persist geolocation',async t=>{
    const {installTodayWeather}=await health;let time=Date.parse('2026-10-08T12:00:00+09:00'),requests=0;
    const html=`<button data-weather-open>날씨</button>${source.match(/<dialog id="todayWeatherModal"[\s\S]*?<\/dialog>/)[0]}`;
    const windows=[];function fixture(saved){const dom=new JSDOM(html,{url:'https://fixture.invalid'});windows.push(dom.window);if(saved)dom.window.sessionStorage.setItem('alcoholaway-public-weather-seoul',saved);return dom.window;}
    t.after(()=>windows.forEach(w=>w.close()));
    const data={utc_offset_seconds:32400,current:{time:'2026-10-08T12:00',temperature_2m:20,weather_code:0},daily:{time:['2026-10-08'],temperature_2m_min:[12],temperature_2m_max:[23],weather_code:[0]}};
    const options=w=>({window:w,document:w.document,now:()=>time,fetch:async()=>{requests++;return{ok:true,json:async()=>data};}});
    const place={key:'seoul',label:'서울',lat:37.57,lon:126.98};const first=fixture();await installTodayWeather(options(first)).lookup(place);
    const saved=first.sessionStorage.getItem('alcoholaway-public-weather-seoul');assert(saved);
    const second=fixture(saved),ui=installTodayWeather(options(second));await ui.lookup(place);assert.equal(requests,1);
    time+=21*60000;await ui.lookup(place);assert.equal(requests,2);
    await ui.lookup({...place,key:'geo:37.57,126.98'});assert.equal(second.sessionStorage.length,1);
});
