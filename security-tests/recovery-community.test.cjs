const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const community=import(pathToFileURL(path.join(root,'community-feed.js'))),goals=import(pathToFileURL(path.join(root,'recovery-goals.js')));
const date=Date.parse('2026-10-09T12:00:00+09:00'),DAY=86400000;
const comment=(uid='other',text='힘내요',createdAt=date)=>({uid,author:uid,text,createdAt,authorDayAtWrite:40});
const post=(id,extra={})=>({id,uid:'other',author:'생존자',content:'오늘도 금주',createdAt:date,authorDayAtWrite:46,comments:[],...extra});
const tick=()=>new Promise(r=>setTimeout(r,5));
function extract(name){const start=source.indexOf(`    function ${name}(`);assert(start>=0,name);return source.slice(start,source.indexOf('\n    }',start)+6);}

test('three current recovery goals follow the real roadmap boundaries and keep progress and wording',async()=>{
    const {currentRecoveryGoals,recoveryGoalsHtml}=await goals;
    const a=source.indexOf('    const stages ='),b=source.indexOf('\n',source.indexOf('    const physicalStages',a));
    const groups=vm.runInNewContext(source.slice(a,b)+`;[{key:'physical',label:'신체',stages:physicalStages},{key:'liver',label:'간',stages:liverStages},{key:'brain',label:'뇌',stages:brainStages}]`);
    const rows=currentRecoveryGoals(groups,45);assert.deepEqual(Array.from(rows,r=>r.stage.d),[60,90,90]);assert.deepEqual(Array.from(rows,r=>r.percent),[75,50,50]);
    assert.deepEqual(Array.from(currentRecoveryGoals(groups,60),r=>r.stage.d),[90,90,90]);
    assert(currentRecoveryGoals(groups,4000).every(r=>r.complete&&r.percent===100));
    assert(currentRecoveryGoals(groups,-2).every(r=>r.percent===0));
    const dom=new JSDOM(recoveryGoalsHtml(rows)),d=dom.window.document;
    assert.equal(d.querySelectorAll('.current-recovery-goal').length,3);assert.equal(d.querySelectorAll('details,button').length,0);assert.equal(d.querySelectorAll('[role="progressbar"]').length,3);
    assert(d.body.textContent.includes(groups[0].stages.find(s=>s.d===60).desc));dom.window.close();
});

test('main timer moves success rate into the former rank location and keeps risk boxes in their separate tab',async()=>{
    const {recoveryGoalsHtml}=await goals;
    const context={getCurrentStreakRecordInfo:()=>({targetDays:45,ordinal:2}),getCurrentRecoveryGoals:()=>[],recoveryGoalsHtml,buildMinAbstinenceProgressHtml:()=>''};
    vm.createContext(context);vm.runInContext(extract('buildStreakRecordBadgeHtml')+extract('buildMainDaysContainerHtml'),context);
    const dom=new JSDOM(context.buildMainDaysContainerHtml(45,125,98)),d=dom.window.document;
    assert.equal(d.querySelectorAll('.success-rate-box').length,1);assert(d.querySelector('.streak-record-info .success-rate-box'));assert.equal(d.querySelector('#streakCurrentRank'),null);
    assert.equal(d.querySelector('[onclick*="openAlcohol"]'),null);assert(source.includes('id="alcoholDiseaseTab"'));assert(source.includes('id="alcoholDiseaseSection"'));
    dom.window.close();
});

test('community filters combine content, UID/nickname, inclusive Korean dates and original sobriety age',async()=>{
    const {filterCommunityPosts:filter,sobrietyDaysAtPost:age,SOBRIETY_RANGES}=await community;
    const rows=[post('a',{uid:'ABC123',author:'주현',content:'산책과 금주',createdAt:Date.parse('2026-10-08T15:00Z')}),post('b',{createdAt:Date.parse('2026-10-09T14:59:59.999Z')}),post('c',{createdAt:Date.parse('2026-10-09T15:00Z')}),post('missing',{createdAt:null,authorDayAtWrite:null})];
    assert.deepEqual(filter(rows,{keyword:' 산책 ',author:'abc',from:'2026-10-09',to:'2026-10-09',duration:'month3'}).map(r=>r.id),['a']);
    assert.deepEqual(filter(rows,{author:'주현'}).map(r=>r.id),['a']);
    assert.deepEqual(filter(rows,{from:'2026-10-09',to:'2026-10-09'}).map(r=>r.id),['a','b']);
    assert.equal(filter(rows,{from:'2026-10-10',to:'2026-10-09'}).length,0);
    for(const range of SOBRIETY_RANGES){const p=post('x',{authorQuitDate:date-range.min*DAY});assert.equal(filter([p],{duration:range.id}).length,1);if(Number.isFinite(range.max))assert.equal(filter([post('x',{authorQuitDate:date-range.max*DAY})],{duration:range.id}).length,0);}
    assert.equal(age(post('old',{authorDayAtWrite:31})),30);assert.equal(age(post('old',{authorDayAtWrite:null})),null);
    assert.equal(filter([rows[3]],{duration:'month1'}).length,0);
});

async function fixture(t,{saved}={}) {
    const {installCommunityFeed}=await community;
    const sourceDoc=new JSDOM(source).window.document;
    const dom=new JSDOM(sourceDoc.getElementById('sectionRecovery').outerHTML,{url:'https://fixture.invalid'}),w=dom.window,d=w.document;
    sourceDoc.defaultView.close();t.after(()=>w.close());
    if(saved)w.localStorage.setItem('alcoholaway-community-read:owner',saved);
    const state={uid:'owner',feeds:[],own:[],stops:0,opened:0};
    const feed=installCommunityFeed({doc:d,win:w,getUid:()=>state.uid,cheers:[{id:'heart',emoji:'💚',label:'응원해요'}],dayAtWrite:r=>r.authorDayAtWrite??null,
        watchPosts:(next,error)=>{state.feeds.push({next,error});return()=>state.stops++;},
        watchOwnPosts:(uid,next,error)=>{state.own.push({uid,next,error});return()=>state.stops++;},
        editPost(){},deletePost(){},addComment(){},deleteComment(){},openCommunity(){state.opened++;feed.show();return true;}});
    const input=(id,value)=>{d.getElementById(id).value=value;d.getElementById(id).dispatchEvent(new w.Event('input',{bubbles:true}));};
    return {w,d,feed,state,input};
}

test('post folding, pagination, combined searches and comment drafts survive live snapshot replacements',async t=>{
    const f=await fixture(t);f.feed.show();f.state.own[0].next([]);
    const rows=Array.from({length:61},(_,i)=>post(`p${i}`,{content:i===60?'마지막 산책 기록':'금주 기록'}));f.state.feeds[0].next(rows);
    assert.equal(f.d.querySelectorAll('.post-card').length,50);assert(f.d.querySelector('.post-card').open===false);
    f.d.getElementById('communityExpandAll').click();assert([...f.d.querySelectorAll('.post-card')].every(c=>c.open));
    const input=f.d.getElementById('cmtInput_p0');input.value='작성 중인 댓글';input.dispatchEvent(new f.w.Event('input'));input.focus();input.setSelectionRange(2,4);
    f.state.feeds[0].next(rows.map((r,i)=>i===0?{...r,comments:[comment()]}:r));
    assert.equal(f.d.activeElement.id,'cmtInput_p0');assert.equal(f.d.activeElement.value,'작성 중인 댓글');assert.equal(f.d.activeElement.selectionStart,2);assert(f.d.querySelector('.post-card').open);
    f.d.getElementById('communityMore').click();assert.equal(f.d.querySelectorAll('.post-card').length,61);assert([...f.d.querySelectorAll('.post-card')].every(c=>c.open));
    f.d.getElementById('communityCollapseAll').click();assert([...f.d.querySelectorAll('.post-card')].every(c=>!c.open));
    f.input('communityKeyword','마지막');assert.equal(f.d.querySelectorAll('.post-card').length,1);assert.equal(f.d.querySelector('.post-card').dataset.postId,'p60');
    f.d.getElementById('communityClearFilters').click();assert.equal(f.d.getElementById('cmtInput_p0').value,'작성 중인 댓글');
    f.state.feeds[0].error(new Error('denied'));assert.equal(f.d.querySelectorAll('.post-card').length,0);assert.match(f.d.getElementById('communityFilterStatus').textContent,/불러오지 못했습니다/);
});

test('own-post alerts baseline on the server, ignore self replies and jump to stable comment IDs despite hidden/old posts',async t=>{
    const f=await fixture(t),{communityCommentId}=await community;
    const old=post('old',{uid:'owner',comments:[comment('other','기존 댓글',date-100)]});f.feed.bindAccount('owner');
    f.state.own[0].next([old],{fromCache:true});assert(f.d.getElementById('communityUnreadBtn').hidden);
    f.state.own[0].next([old],{fromCache:false});assert(f.d.getElementById('communityUnreadBtn').hidden);
    const added=comment('friend','새로 도착한 댓글',date+1),ownReply=comment('owner','내 답글',date+2);
    f.state.own[0].next([{...old,comments:[added,ownReply]}]);assert.equal(f.feed.getUnread().length,1);
    f.input('communityKeyword','검색에서 숨겨진 글');f.d.getElementById('communityUnreadBtn').click();
    assert.equal(f.state.opened,1);assert.equal(f.d.querySelector('.post-card').dataset.postId,'old');assert(f.d.querySelector('.post-card').open);
    const target=f.d.getElementById(communityCommentId('old',added));assert.equal(f.d.activeElement,target);assert(target.classList.contains('comment-notification-focus'));assert.equal(f.feed.getUnread().length,0);
    f.state.feeds[0].next([post('fresh')]);assert.equal(f.d.activeElement.id,target.id);assert(f.d.activeElement.classList.contains('comment-notification-focus'));
    const saved=f.w.localStorage.getItem('alcoholaway-community-read:owner');assert(saved&&!saved.includes('새로 도착한 댓글'));
    const reloaded=await fixture(t,{saved});reloaded.feed.bindAccount('owner');reloaded.state.own[0].next([{...old,comments:[added]}]);assert.equal(reloaded.feed.getUnread().length,0);
    const newer=comment('friend','새 댓글 2',date+3);reloaded.state.own[0].next([{...old,comments:[added,newer]}]);assert.equal(reloaded.feed.getUnread().length,1);
    reloaded.state.own[0].next([]);assert.equal(reloaded.feed.getUnread().length,0);
});

test('account switches and late listener callbacks clear drafts, post content and notification badges',async t=>{
    const f=await fixture(t);f.feed.show();f.state.feeds[0].next([post('private',{uid:'owner'})]);f.state.own[0].next([]);
    f.state.own[0].next([post('private',{uid:'owner',comments:[comment()]})]);assert.equal(f.feed.getUnread().length,1);
    const oldFeed=f.state.feeds[0],oldOwn=f.state.own[0];f.state.uid='other';f.feed.bindAccount('other');
    oldFeed.next([post('stale')]);oldOwn.next([post('private',{uid:'owner',comments:[comment()]})]);
    assert.equal(f.d.querySelectorAll('.post-card').length,0);assert.equal(f.feed.getUnread().length,0);assert(f.d.getElementById('communityUnreadBtn').hidden);assert(f.state.stops>=2);
    f.feed.show();f.state.feeds.at(-1).next([post('new')]);f.feed.hide();f.state.feeds.at(-1).next([post('late')]);assert.equal(f.d.querySelector('.post-card').dataset.postId,'new');
});

test('account deletion removes only that account’s persisted comment read fingerprints',async t=>{
    const {clearAccountLocalData}=await import(pathToFileURL(path.join(root,'account-deletion.js')));
    const dom=new JSDOM('',{url:'https://fixture.invalid'});t.after(()=>dom.window.close());const w=dom.window;
    w.localStorage.setItem('alcoholaway-community-read:owner','opaque');w.localStorage.setItem('alcoholaway-community-read:other','keep');
    clearAccountLocalData('owner',w.localStorage,w.sessionStorage);assert.equal(w.localStorage.getItem('alcoholaway-community-read:owner'),null);assert.equal(w.localStorage.getItem('alcoholaway-community-read:other'),'keep');
});
