const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const modulePromise=import(pathToFileURL(path.join(root,'daily-wisdom.js')));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const now=Date.parse('2026-09-30T07:00:00+09:00');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('advice scrolls only when overflowing and remeasures after width/text changes',async t=>{
  const f=await fixture(t);
  const button=f.doc.querySelector('[data-daily-wisdom-open]');
  let width=100,textWidth=280;
  Object.defineProperty(button,'clientWidth',{get:()=>width});
  Object.defineProperty(button.querySelector('.daily-wisdom-text'),'scrollWidth',{get:()=>textWidth});
  f.ui.renderTrigger();
  assert(button.classList.contains('is-overflowing'));
  assert.equal(button.style.getPropertyValue('--wisdom-distance'),'-180px');
  assert.equal(button.querySelectorAll('.daily-wisdom-text').length,1);
  assert(button.getAttribute('aria-label').includes(button.textContent));
  width=320;button.ownerDocument.defaultView.dispatchEvent(new button.ownerDocument.defaultView.Event('resize'));
  assert(!button.classList.contains('is-overflowing'));
  width=0;f.ui.renderTrigger();assert(!button.classList.contains('is-overflowing'),'hidden buttons are not animated');
  width=100;textWidth=80;f.ui.renderTrigger();assert(!button.classList.contains('is-overflowing'));
});

async function fixture(t,overrides={}) {
  const modal=html.match(/<dialog id="dailyWisdomModal"[\s\S]*?<\/dialog>/)[0];
  const dom=new JSDOM(`<button data-daily-wisdom-open></button>${modal}`,{url:'https://fixture.invalid/'});
  t.after(()=>dom.window.close());
  const doc=dom.window.document,dialog=doc.getElementById('dailyWisdomModal');
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new dom.window.Event('close'));};
  const requests=[],records=new Map();let generation=0,failRating=false;
  const api=async data=>{
    requests.push(structuredClone(data));
    if(data.action==='list')return {items:[...records.values()].reverse(),cursor:null};
    if(data.action==='save'){
      if(!records.has(data.id))records.set(data.id,{id:data.id,text:data.text,createdAt:now+records.size,rating:0});
      return {item:{...records.get(data.id)}};
    }
    if(data.action==='rate'){
      if(failRating)throw new Error('Offline');
      const item={...records.get(data.id),rating:data.rating};records.set(data.id,item);return {item};
    }
  };
  const options={document:doc,window:dom.window,now:()=>now,api,
    loadContext:async uid=>({uid,today:'2026-09-30',health:[],posts:[],challenges:[]}),
    generate:async()=>`오늘의 작은 실천 ${++generation}번을 응원해요.`,...overrides};
  const {installDailyWisdom}=await modulePromise;
  const ui=installDailyWisdom(options);
  return {doc,dialog,ui,requests,records,api,setFailRating:value=>{failRating=value;},generation:()=>generation};
}

test('context covers diagnosis, condition, states, sleep and only the owner’s communications',async()=>{
  const {buildWisdomContext}=await modulePromise;
  const context=buildWisdomContext({uid:'owner',today:'2026-09-30',quitDate:'2026-09-25T07:00:00+09:00',
    health:[{date:'2026-09-29',note:'연락 test@example.com 010-1234-5678',condition:0,stress:8,sleep:{minutes:360,quality:2},
      diagnoses:[{name:'전정신경염',date:'2026-09-01'},{name:'회복 질환',date:'2026-09-02',recoveredDate:'2026-09-20'}]}],
    challenges:[{cravings:[{type:'state',timestamp:now-1000,fatigue:8},{type:'state',timestamp:0,fatigue:1}]}],
    dailyLogs:{'2026-09-29':{alcohol:0,weight:65,private:'NEVER'}},
    posts:[{uid:'other',content:'OTHER PRIVATE',createdAt:now,comments:[{uid:'owner',text:'도움을 받아 고비를 넘겼어요',createdAt:now}]},
      {uid:'owner',content:'오늘은 피곤해요',createdAt:now,author:'REAL NAME',comments:[{uid:'other',text:'OTHER COMMENT',createdAt:now}]}]
  },now);
  assert.equal(context.challengeDay,6);assert.equal(context.activeDiagnoses[0].day,30);
  assert.equal(context.activeDiagnoses.length,1);assert.equal(context.recentHealth[0].condition,0);
  assert.equal(context.recentStates.length,1);assert.equal(context.recentHealth[0].sleepMinutes,360);
  assert.equal(context.ownRecentCommunications.length,2);
  for(const forbidden of ['OTHER PRIVATE','OTHER COMMENT','REAL NAME','NEVER','test@example.com','010-1234-5678','"uid"'])assert(!JSON.stringify(context).includes(forbidden));
});

test('each visit generates once, survives a timer rerender, and ratings persist on another visit',async t=>{
  const f=await fixture(t);f.ui.bindAccount('owner');await f.ui.start('owner');await f.ui.start('owner');
  assert.equal(f.generation(),1);assert.equal(f.records.size,1);
  f.doc.querySelector('[data-daily-wisdom-open]').textContent='timer replaced';f.ui.renderTrigger();
  assert.match(f.doc.querySelector('[data-daily-wisdom-open]').textContent,/1번/);
  f.doc.querySelector('[data-daily-wisdom-open]').click();assert.equal(f.dialog.open,true);
  f.doc.querySelector('#dailyWisdomCurrent [data-wisdom-rating="5"]').click();await tick();
  assert.equal([...f.records.values()][0].rating,5);
  assert.equal(f.doc.querySelector('#dailyWisdomCurrent [aria-pressed="true"]').dataset.wisdomRating,'5');
  f.ui.bindAccount(null);assert.equal(f.dialog.open,false);assert(!f.doc.body.textContent.includes('1번'));
  f.ui.bindAccount('owner');await f.ui.start('owner');assert.equal(f.generation(),2);
  assert.match(f.doc.getElementById('dailyWisdomHistory').textContent,/1번/);
  assert.match(f.doc.getElementById('dailyWisdomHistory').textContent,/5\/5/);
});

test('failed rating keeps the last saved stars and can be retried',async t=>{
  const f=await fixture(t);f.ui.bindAccount('owner');await f.ui.start('owner');
  f.doc.querySelector('#dailyWisdomCurrent [data-wisdom-rating="2"]').click();await tick();
  f.setFailRating(true);f.doc.querySelector('#dailyWisdomCurrent [data-wisdom-rating="5"]').click();await tick();
  assert.equal([...f.records.values()][0].rating,2);
  assert.equal(f.doc.querySelector('#dailyWisdomCurrent [aria-pressed="true"]').dataset.wisdomRating,'2');
  assert.match(f.doc.getElementById('dailyWisdomStatus').textContent,/저장하지 못/);
  f.setFailRating(false);f.doc.querySelector('#dailyWisdomCurrent [data-wisdom-rating="4"]').click();await tick();
  assert.equal([...f.records.values()][0].rating,4);
});

test('logout during generation discards the old response without saving into another account',async t=>{
  const p=pending(),f=await fixture(t,{generate:()=>p.promise});
  f.ui.bindAccount('old');const run=f.ui.start('old');await tick();
  f.ui.bindAccount('new');p.resolve('OLD ACCOUNT SECRET');await run;
  assert(!f.doc.body.textContent.includes('OLD ACCOUNT'));assert.equal(f.requests.filter(x=>x.action==='save').length,0);
});

test('AI failure uses labelled fallback and retry obtains a fresh saved advice',async t=>{
  let calls=0;const f=await fixture(t,{generate:async()=>{if(!calls++)throw new Error('AI unavailable');return '조금 쉬어 가도 괜찮아요.';}});
  f.ui.bindAccount('owner');await f.ui.start('owner');
  assert.equal(f.records.size,0);assert.match(f.doc.getElementById('dailyWisdomStatus').textContent,/기본 응원/);
  f.doc.getElementById('dailyWisdomRetry').click();await tick();await tick();
  assert.equal(f.records.size,1);assert.match(f.doc.querySelector('[data-daily-wisdom-open]').textContent,/조금 쉬어/);
});

test('an uncertain save retries the same ID without another AI call',async t=>{
  let f,failOnce=true;
  f=await fixture(t,{api:async data=>{const result=await f.api(data);if(data.action==='save'&&failOnce){failOnce=false;throw new Error('Lost response');}return result;}});
  f.ui.bindAccount('owner');await f.ui.start('owner');
  assert.equal(f.records.size,1);assert(f.doc.querySelector('#dailyWisdomCurrent .wisdom-star').disabled);
  f.doc.getElementById('dailyWisdomRetry').click();await tick();await tick();
  assert.equal(f.records.size,1);assert.equal(f.generation(),1);
  assert(!f.doc.querySelector('#dailyWisdomCurrent .wisdom-star').disabled);
  const saves=f.requests.filter(x=>x.action==='save');assert.equal(saves[0].id,saves[1].id);
});

test('history pagination displays older advice and malicious stored text stays inert',async t=>{
  const malicious='<img src=x onerror="alert(1)">';
  const old={id:'previous_entry_0001',text:malicious,createdAt:now-2000,rating:3};
  let f;f=await fixture(t,{api:async data=>data.action==='list'?
    data.cursor?{items:[old],cursor:null}:{items:[],cursor:'next_page_00000001'}:f.api(data)});
  f.ui.bindAccount('owner');await f.ui.start('owner');assert(!f.doc.getElementById('dailyWisdomMore').hidden);
  f.doc.getElementById('dailyWisdomMore').click();await tick();
  assert(f.doc.getElementById('dailyWisdomHistory').textContent.includes(malicious));
  assert.match(f.doc.getElementById('dailyWisdomHistory').textContent,/3\/5/);
  assert.equal(f.doc.querySelector('img'),null);assert(f.doc.getElementById('dailyWisdomMore').hidden);
});

test('generated invalid markup and oversized answers never become a saved advice',async()=>{
  const {normalizeWisdom}=await modulePromise;
  for(const text of ['','<script>alert(1)</script>','x'.repeat(161)])assert.throws(()=>normalizeWisdom(text));
  assert.equal(normalizeWisdom('“오늘도\n 한 걸음.”'),'오늘도 한 걸음.');
});
