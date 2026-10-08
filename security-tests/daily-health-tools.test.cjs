
async function waitFor(check) { for (let i=0;i<200;i++) { if(check())return; await new Promise(r=>setTimeout(r,5)); } assert.fail('async result did not arrive'); }
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const modulePromise = import(pathToFileURL(path.join(root, 'daily-health-tools.js')));
const now = Date.parse('2026-10-01T04:00:00Z');
const weatherData = () => ({utc_offset_seconds:32400,current:{time:'2026-10-01T13:00',temperature_2m:22.4,weather_code:2},daily:{time:['2026-10-01'],temperature_2m_min:[14.5],temperature_2m_max:[25.2],weather_code:[63]}});
const tick = () => new Promise(resolve => setImmediate(resolve));
function domFixture(t) {
    const dom = new JSDOM(html, {url:'https://fixture.invalid/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
    t.after(() => dom.window.close()); return dom.window;
}
function extract(name) {
    const isWindow = html.includes(`    window.${name} = `);
    const start = html.indexOf(isWindow ? `    window.${name} = ` : `    function ${name}(`);
    const ending = isWindow ? '\n    };' : '\n    }';
    assert(start >= 0, name); return html.slice(start,html.indexOf(ending,start)+ending.length);
}
async function diaryFixture(t) {
    const w = domFixture(t), data = new Map(), clone = value => JSON.parse(JSON.stringify(value));
    let nextId = 0;
    const parent = {id:'parent',date:'2026-09-29',diagnoses:[{name:'같은 질환',date:'2026-09-29'},{name:'같은 질환',date:'2026-09-28'}]};
    const consent = {version:'policy',status:'granted',personal:true,sensitive:true};
    data.set('users/owner/health_entries/parent',clone(parent)); data.set('users/owner/health_consents/health',consent);
    const hr={uid:'owner',generation:1,entries:[clone(parent)],errors:{},busy:false,diarySaving:false,consents:{health:consent}};
    Object.assign(w, {hr, db:{}, HR_POLICY_VERSION:'policy', hrEl:id=>w.document.getElementById(id), hrToday:()=> '2026-10-01',
        hrSameUser:uid => uid === hr.uid, hrRequireConsent:async()=>true, hrOpen:id => {w.document.getElementById(id).hidden=false;},
        hrRenderDiagnoses(){}, hrRefreshHealthUI(){w.hrRenderDiagnosisDiary();},hrErrorMessage:()=> '저장 오류',
        hrAbstinenceSignature:value=>JSON.stringify(value||null),hrAbstinencePlan:value=>value,
        confirm:()=>true,serverTimestamp:()=> 'server-time',collection:(_, ...parts)=>({path:parts.join('/')}),
        doc:(_, ...parts)=> parts.length ? {id:parts.at(-1),path:parts.join('/')} : {id:`new${++nextId}`},
        runTransaction:async(_,callback)=>{
            const pending=[];
            const result=await callback({
                get:async ref => ({exists:()=>data.has(ref.path), data:()=>data.has(ref.path)?clone(data.get(ref.path)):undefined}),
                set:(ref,value)=>pending.push(()=>data.set(ref.path,clone(value))),
                update:(ref,value)=>pending.push(()=>data.set(ref.path,{...data.get(ref.path),...clone(value)})),
                delete:ref=>pending.push(()=>data.delete(ref.path))
            }); pending.forEach(fn=>fn()); return result;
        }
    });
    for(const name of ['hrValidDate','hrDayNumber','hrRecoveryDetails','hrSetStatus','hrRecordConflict','hrDiaryEntries','hrDiarySignature','hrRenderDiagnosisDiary','openDiagnosisDiary','changeDiagnosisDiaryDate','saveDiagnosisDiary','hrDiagnosisSignature','addHealthDiagnosisInput','hrReadHealthForm']) w.eval(extract(name));
    return {w,hr,data,el:id=>w.document.getElementById(id),entries:()=>[...data.values()].filter(v=>v.recordType==='diagnosis_diary')};
}

test('all 12 local two-hour boundaries, ties, missing dates and nonfailed records',async()=>{
    const {failureTimeStats}=await modulePromise;
    const ended=hour=>({status:'failed',endDate:new Date(2026,8,30,hour,59,59)});
    const list=Array.from({length:24},(_,h)=>ended(h));
    const stats=failureTimeStats(list,now); assert.deepEqual(stats.counts,Array(12).fill(2)); assert.equal(stats.peaks.length,12);
    list.push(ended(22),ended(23),{status:'active',endDate:new Date(2026,8,30,2)},
        {status:'failed',endDate:'2026-09-30'},{status:'failed',endDate:'invalid'},
        {status:'failed',endDate:new Date(2026,8,30),hasRecordedEndDate:false},{status:'failed',endDate:'2099-01-01T20:00:00Z'});
    const result=failureTimeStats(list,now); assert.deepEqual(result.peaks,[11]); assert.equal(result.skipped,4); assert.equal(result.total,26);
    assert.deepEqual(failureTimeStats([]).peaks,[]);
});
test('risk UI creates exactly 12 segments, marks ties and clears on account reset/errors',async t=>{
    const w=domFixture(t), {renderFailureTimeRisk}=await modulePromise;
    renderFailureTimeRisk(w.document,[{status:'failed',endDate:new Date(2026,8,20,18)},{status:'failed',endDate:new Date(2026,8,20,20)}]);
    assert.equal(w.document.querySelectorAll('.sub-failure-segment').length,12); assert.equal(w.document.querySelectorAll('.is-peak').length,2);
    assert.match(w.document.getElementById('subFailureSummary').textContent,/18~20시, 20~22시/);
    renderFailureTimeRisk(w.document,[]); assert.equal(w.document.querySelectorAll('.is-peak').length,0);
    renderFailureTimeRisk(w.document,[],{error:true}); assert.match(w.document.getElementById('subFailureSummary').textContent,/못했습니다/);
});
test('taste craving keeps the existing default and option text',t=>{
    const w=domFixture(t), select=w.document.getElementById('cravingReason');
    assert.equal(select.value,'스트레스'); assert.match(select.querySelector('option[value="주류의 맛"]').textContent,/맥주나 주류의 맛/);
});
test('diary saves once per diagnosis/date, edits, reloads previous days and deletes',async t=>{
    const {w,hr,el,entries}=await diaryFixture(t);
    w.openDiagnosisDiary('parent',0);el('diagnosisDiaryNote').value='첫 기록';await w.saveDiagnosisDiary();
    assert.equal(entries().length,1);assert.equal(entries()[0].note,'첫 기록');const stableId=entries()[0].diagnosisId;
    assert.equal(hr.entries.find(e=>e.id==='parent').diagnoses[0].id,stableId);
    el('diagnosisDiaryNote').value='수정 기록';await w.saveDiagnosisDiary();assert.equal(entries().length,1);assert.equal(entries()[0].revision,2);
    el('diagnosisDiaryDate').value='2026-09-30';w.changeDiagnosisDiaryDate();el('diagnosisDiaryNote').value='어제 기록';await w.saveDiagnosisDiary();assert.equal(entries().length,2);
    el('diagnosisDiaryDate').value='2026-10-01';w.changeDiagnosisDiaryDate();assert.equal(el('diagnosisDiaryNote').value,'수정 기록');
    await w.saveDiagnosisDiary(true);assert.equal(entries().length,1);assert.equal(entries()[0].date,'2026-09-30');assert.equal(el('diagnosisDiaryNote').value,'');
});
test('same-name episodes and recovered diagnoses have independent diaries; text is inert',async t=>{
    const {w,hr,el,entries}=await diaryFixture(t);const payload='<img src=x onerror="alert(1)">';
    w.openDiagnosisDiary('parent',0);el('diagnosisDiaryNote').value=payload;await w.saveDiagnosisDiary();
    assert.equal(el('diagnosisDiaryList').querySelector('img'),null);assert.match(el('diagnosisDiaryList').textContent,/<img/);
    hr.entries.find(e=>e.id==='parent').diagnoses[1].recoveredDate='2026-09-30';
    w.openDiagnosisDiary('parent',1);assert.equal(el('diagnosisDiaryNote').value,'');el('diagnosisDiaryNote').value='회복 후 기록';await w.saveDiagnosisDiary();
    assert.equal(entries().length,2);assert.notEqual(entries()[0].diagnosisId,entries()[1].diagnosisId);
    w.openDiagnosisDiary('parent',0);assert.equal(el('diagnosisDiaryNote').value,payload);
});
test('concurrent diary edits never overwrite the other saved version and keep the draft',async t=>{
    const {w,el,data,entries}=await diaryFixture(t);
    w.openDiagnosisDiary('parent',0);el('diagnosisDiaryNote').value='원본';await w.saveDiagnosisDiary();
    const [key,value]=[...data.entries()].find(([,v])=>v.recordType==='diagnosis_diary');data.set(key,{...value,note:'다른 기기 기록',revision:2});
    el('diagnosisDiaryNote').value='이 창의 초안';await w.saveDiagnosisDiary();
    assert.equal(entries()[0].note,'다른 기기 기록');assert.equal(el('diagnosisDiaryNote').value,'이 창의 초안');assert.match(el('diagnosisDiaryStatus').textContent,/다른 화면/);
});
test('deletion, consent revocation, future dates and account switching prevent diary writes',async t=>{
    const {w,hr,el,data,entries}=await diaryFixture(t);
    w.openDiagnosisDiary('parent',0);el('diagnosisDiaryNote').value='기록';el('diagnosisDiaryDate').value='2026-10-02';await w.saveDiagnosisDiary();assert.equal(entries().length,0);
    el('diagnosisDiaryDate').value='2026-10-01';data.delete('users/owner/health_entries/parent');await w.saveDiagnosisDiary();assert.match(el('diagnosisDiaryStatus').textContent,/삭제/);assert.equal(entries().length,0);
    data.set('users/owner/health_entries/parent',hr.entries[0]);data.set('users/owner/health_consents/health',{status:'revoked'});await w.saveDiagnosisDiary();assert.match(el('diagnosisDiaryStatus').textContent,/동의 상태/);assert.equal(entries().length,0);
    w.hrRequireConsent=async()=>{hr.uid='other';hr.generation++;hr.diaryTarget=null;return true;};await w.saveDiagnosisDiary();assert.equal(entries().length,0);
});
test('diagnosis form retains stable identity through name/date edits and conflict signatures see identity changes',async t=>{
    const {w,hr,el}=await diaryFixture(t);hr.day='2026-10-01';
    el('healthDiagnosisInputs').replaceChildren();w.addHealthDiagnosisInput('옛 이름','2026-09-29','','','stable');
    el('healthDiagnosisInputs').querySelector('[data-diagnosis-name]').value='새 이름';
    el('healthEntryTime').value='10:00';
    const form=w.hrReadHealthForm();assert.equal(form.diagnoses[0].id,'stable');assert.equal(form.diagnoses[0].name,'새 이름');
    assert.notEqual(w.hrDiagnosisSignature([{name:'x',date:'2026-09-29'}]),w.hrDiagnosisSignature([{id:'stable',name:'x',date:'2026-09-29'}]));
});
test('today weather uses provider-local date, preserves zero and refuses null temperatures',async()=>{
    const {parseTodayWeather,weatherDescription}=await modulePromise;
    assert.equal(parseTodayWeather(weatherData(),now).min,14.5);const d=weatherData();d.daily.temperature_2m_min[0]=0;assert.equal(parseTodayWeather(d,now).min,0);
    d.daily.temperature_2m_min[0]=null;assert.throws(()=>parseTodayWeather(d,now));
    assert.throws(()=>parseTodayWeather(weatherData(),now+86400000));assert.equal(weatherDescription(null),'기상상황 미확인');
    assert.match(weatherDescription(97),/강한 뇌우/);
});
test('weather is on demand, supports location denial, caches and drops out-of-order responses',async t=>{
    const w=domFixture(t),{installTodayWeather}=await modulePromise;let calls=0, locations=0,time=now;const pending=[];
    const dialog=w.document.getElementById('todayWeatherModal');dialog.showModal=()=>dialog.setAttribute('open','');
    dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new w.Event('close'));};
    Object.defineProperty(w.navigator,'geolocation',{value:{getCurrentPosition:(_,fail)=>{locations++;fail({code:1});}}});
    const api=installTodayWeather({document:w.document,window:w,now:()=>time,fetch:(url,options)=>{calls++;assert.equal(options.credentials,'omit');assert.match(url,/timezone=auto/);return new Promise(resolve=>pending.push(resolve));}});
    assert.equal(calls,0);assert.equal(locations,0);
    w.document.querySelector('[data-weather-open]').click();assert(dialog.open);assert.equal(locations,0);
    api.locate();assert.equal(locations,1);assert.match(w.document.getElementById('weatherStatus').textContent,/지역을 선택/);
    const a=api.lookup({key:'seoul',label:'서울',lat:37.57,lon:126.98});await waitFor(()=>pending.length===1);const b=api.lookup({key:'busan',label:'부산',lat:35.18,lon:129.08});await waitFor(()=>pending.length===2);
    pending[1]({ok:true,json:async()=>weatherData()});await b;pending[0]({ok:true,json:async()=>weatherData()});await a;
    assert.match(w.document.getElementById('weatherPlace').textContent,/부산/);
    await api.lookup({key:'busan',label:'부산',lat:35.18,lon:129.08});assert.equal(calls,2);
    time+=86400000;const c=api.lookup({key:'busan',label:'부산',lat:35.18,lon:129.08});await waitFor(()=>calls===3);assert.equal(calls,3);
    pending[2]({ok:false});await c;assert(w.document.getElementById('weatherResult').hidden);assert.match(w.document.getElementById('weatherStatus').textContent,/못했습니다/);
});
test('weather CSP is narrowly allowed and both user headers have a weather button',t=>{
    const w=domFixture(t);assert.equal(w.document.querySelectorAll('.header-name-weather [data-weather-open]').length,2);
    const csp=w.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    assert.match(csp,/connect-src[^;]+https:\/\/api\.open-meteo\.com/);
});
