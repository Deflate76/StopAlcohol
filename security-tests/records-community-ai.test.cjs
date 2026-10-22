const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const records=import(pathToFileURL(path.join(root,'accumulated-records.js'))),ai=import(pathToFileURL(path.join(root,'community-ai.js')));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('attempt chronology, competition ranks and bar ratios use exact durations including ties and missing dates',async()=>{
    const {buildAccumulatedRecords,recordRankClass,accumulatedChartConfig}=await records;
    const rows=buildAccumulatedRecords([
        {originalIndex:0,startMs:30,durationMs:86400000},
        {originalIndex:1,startMs:10,durationMs:172800000},
        {originalIndex:2,startMs:20,durationMs:86400000,isActive:true},
        {originalIndex:3,startMs:null,durationMs:null},
        {originalIndex:4,startMs:40,durationMs:0},
        {originalIndex:5,startMs:50,durationMs:-1}
    ]);
    assert.deepEqual(rows.map(r=>r.originalIndex),[1,2,0,4,5,3]);
    assert.deepEqual(rows.map(r=>r.attempt),[1,2,3,4,5,6]);
    assert.deepEqual(rows.map(r=>r.durationRank),[1,2,2,4,null,null]);
    assert.deepEqual(rows.map(r=>r.durationPercent),[100,50,50,0,0,0]);
    assert.equal(rows[1].tiedRank,true);assert.equal(recordRankClass(3),'rank-third');
    const chart=accumulatedChartConfig([...rows].reverse(),{formatDuration:String,formatDate:String});
    assert.deepEqual(chart.data.datasets[0].data,[2,1,1,0,null,null]);
    assert.deepEqual(chart.data.labels,['1회','2회','3회','4회','5회','6회']);
    assert.equal(chart.data.datasets[0].borderWidth[1],2);assert.equal(buildAccumulatedRecords([]).length,0);
    assert.equal(buildAccumulatedRecords([{startMs:1,originalIndex:0,durationMs:0}])[0].durationPercent,0);
});

test('only the clicked section is selected; nested details and programmatic navigation preserve folding',async t=>{
    const {installSectionSelection}=await import(pathToFileURL(path.join(root,'section-selection.js')));
    const dom=new JSDOM('<div id="displayArea"><section id="timerDisplaySection" class="inline-collapsible-section" data-collapsed="false"><button class="inline-collapsible-summary">타이머</button></section><details id="sectionRecovery" class="main-section" open><summary>회복</summary><details id="nested"><summary>목표</summary></details></details><div id="dynamic"></div></div>');
    t.after(()=>dom.window.close());const d=dom.window.document,ui=installSectionSelection({doc:d});
    assert.equal(d.querySelector('.is-selected-section').id,'timerDisplaySection');
    d.querySelector('#nested summary').click();assert(d.getElementById('nested').open);
    assert.equal(d.querySelectorAll('.is-selected-section').length,1);assert.equal(d.querySelector('.is-selected-section').id,'sectionRecovery');
    assert(d.getElementById('sectionRecovery').open);assert.equal(d.getElementById('timerDisplaySection').dataset.collapsed,'false');
    d.getElementById('dynamic').innerHTML='<section id="later" class="inline-collapsible-section"><button class="inline-collapsible-summary">요약</button></section>';
    d.querySelector('#later button').click();ui.refresh();assert.equal(d.querySelector('.is-selected-section').id,'later');
    ui.select('timerDisplaySection');assert.equal(d.querySelector('.is-selected-section').id,'timerDisplaySection');
});

async function fixture(generate) {
    const m=await ai,state={uid:'owner',time:1000,sequence:0,posts:new Map(),writes:0},timers=new Map();let timer=0,queue=Promise.resolve();
    const transact=(id,change)=>{const task=queue.then(()=>{const post=state.posts.get(id),result=change(post?structuredClone(post):null);if(result?.patch){state.posts.set(id,{...post,...result.patch});state.writes++;}return result?.value;});queue=task.catch(()=>{});return task;};
    const controller=m.installCommunityAdvice({getUid:()=>state.uid,now:()=>state.time,makeId:()=>String(++state.sequence),transact,generate,
        setTimer:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;},clearTimer:id=>timers.delete(id)});
    controller.bindAccount('owner');
    state.posts.set('p',{uid:'owner',content:'퇴근길 고비를 넘겼어요',comments:[m.createCommunityAdviceSlot('owner',1000)]});
    return {m,state,controller,timers,slot:()=>state.posts.get('p')?.comments.find(m.isCommunityAdvice)};
}

test('concurrent retries save exactly one AI comment without overwriting a new human reply',async()=>{
    const answer=deferred();let calls=0,received;
    const f=await fixture(async context=>{calls++;received=context;return answer.promise;});
    const first=f.controller.run('p');await tick();await f.controller.run('p');
    f.state.posts.get('p').comments.push({uid:'friend',author:'동료',text:'응원해요',createdAt:1200});
    answer.resolve('고비를 넘긴 경험을 기억해 주세요. 편안한 산책을 해보셔도 좋겠습니다.');await first;
    await f.controller.run('p',{retry:true});assert.equal(calls,1);assert.equal(f.slot().state,'ready');
    assert.equal(f.state.posts.get('p').comments.length,2);assert.equal(f.state.posts.get('p').comments[1].text,'응원해요');
    assert.deepEqual(Object.keys(received),['post']);assert(!JSON.stringify(received).includes('owner'));
});

test('failed/empty AI response leaves the post intact and retry fills the same slot',async()=>{
    let result='';const f=await fixture(async()=>result);await f.controller.run('p');assert.equal(f.slot().state,'failed');
    assert.equal(f.state.posts.get('p').content,'퇴근길 고비를 넘겼어요');result='작은 실천을 이어가 보세요.';
    await f.controller.run('p');assert.equal(f.slot().state,'failed');
    await f.controller.run('p',{retry:true});assert.equal(f.slot().state,'ready');assert.equal(f.state.posts.get('p').comments.length,1);
});

test('deleted posts/comments and changed accounts never receive a late AI reply',async()=>{
    for(const mode of ['post','comment','account']) {
        const answer=deferred(),f=await fixture(()=>answer.promise),request=f.controller.run('p');await tick();
        if(mode==='post')f.state.posts.delete('p');
        if(mode==='comment')f.state.posts.get('p').comments=[];
        if(mode==='account'){f.state.uid='other';f.controller.bindAccount('other');}
        const writes=f.state.writes;answer.resolve('늦게 도착한 답변');await request;assert.equal(f.state.writes,writes,mode);
        if(mode==='post')assert.equal(f.state.posts.has('p'),false);
    }
});

test('an edited post cannot receive advice generated for the old text',async()=>{
    const answer=deferred(),f=await fixture(()=>answer.promise),request=f.controller.run('p');await tick();
    f.state.posts.get('p').content='수정된 글';answer.resolve('원래 글에 대한 조언');await request;
    assert.equal(f.slot().state,'failed');assert.equal(f.slot().text,'');
});

test('reloading resumes only explicitly queued advice; a live lease is respected across clients',async()=>{
    let calls=0;const f=await fixture(async()=>{calls++;return '천천히 하루를 마무리해 보세요.';});
    f.state.posts.set('old',{uid:'owner',content:'기존 게시글',comments:[]});
    f.slot().state='pending';f.slot().requestId='other-client';f.slot().leaseUntil=2000;
    f.controller.resume([...f.state.posts].map(([id,p])=>({id,...p})));assert.equal(f.timers.size,1);
    assert.equal([...f.timers.values()][0].delay,1050);await f.controller.run('p',{retry:true});assert.equal(calls,0);
    f.state.time=2100;await f.controller.run('p');assert.equal(calls,1);assert.equal(f.slot().state,'ready');
    assert.equal(f.state.posts.get('old').comments.length,0);
    f.controller.bindAccount(null);assert.equal(f.timers.size,0);
});

test('AI replies are visibly labeled, escaped and counted once without pretending to be the author',async t=>{
    const {installCommunityFeed}=await import(pathToFileURL(path.join(root,'community-feed.js'))),{createCommunityAdviceSlot}=await ai;
    const page=new JSDOM(source),dom=new JSDOM(page.window.document.getElementById('sectionCommunity').outerHTML,{url:'https://fixture.invalid'});page.window.close();t.after(()=>dom.window.close());
    const d=dom.window.document;let next,retries=0;
    const feed=installCommunityFeed({doc:d,win:dom.window,getUid:()=> 'owner',watchPosts:cb=>{next=cb;return()=>{};},watchOwnPosts:()=>()=>{},dayAtWrite:()=>999,retryAdvice:()=>{retries++;}});
    feed.show();const slot={...createCommunityAdviceSlot('owner',1000),state:'ready',text:'<img src=x onerror=alert(1)>조언'};
    next([{id:'p',uid:'owner',content:'본문',comments:[slot]}]);
    assert.equal(d.querySelectorAll('.comment-ai').length,1);assert.equal(d.querySelector('.comment-ai .day-badge'),null);assert.equal(d.querySelector('.comment-ai img'),null);
    assert.equal(d.querySelector('.comment-ai .comment-author').textContent,'금도끼 AI');assert.match(d.querySelector('.post-summary-footer').textContent,/댓글 1개/);
    next([{id:'p',uid:'owner',content:'본문',comments:[{...slot,state:'failed',text:''}]}]);
    d.querySelector('[data-community-action="retry-advice"]').click();assert.equal(retries,1);assert.match(d.querySelector('.post-summary-footer').textContent,/댓글 0개/);
});
