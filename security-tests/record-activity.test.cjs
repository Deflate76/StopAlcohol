const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const modulePromise = import(pathToFileURL(path.join(root,'record-activity.js')));
const at = Date.parse('2026-10-05T12:00:00+09:00'), DAY = 86400000;
function extract(name, windowFunction = false) {
    const start = html.indexOf(windowFunction ? `    window.${name} = ` : `    function ${name}(`);
    const endToken = windowFunction ? '\n    };' : '\n    }';
    const end = html.indexOf(endToken,start);
    assert(start >= 0 && end > start);
    return html.slice(start,end+endToken.length);
}

test('activity uses save time in Korea, excludes yesterday and defaults, and keeps all actual categories', async () => {
    const {summarizeTodayActivity,koreaDayKey} = await modulePromise;
    assert.equal(koreaDayKey('2026-10-04T15:00:00Z'),'2026-10-05');
    const craving={timestamp:at-1000,reason:'회식',strength:7};
    const data={currentId:'active',challenges:[{id:'active',cravings:[craving]},{id:'old',cravings:[{timestamp:at-DAY,reason:'어제'}]}],
        cravings:[craving,{type:'state',timestamp:at,mood:0,fatigue:3},{type:'action',timestamp:at,actionName:'산책'},
            {type:'medication',timestamp:at-3*DAY,recordedAt:at,drugName:'기록약',dose:50}],
        bodyLogs:[{recordedAt:at,measuredAt:at-DAY,weight:70,height:175}],
        dailyLogs:{'2026-10-05':{updatedAt:at,breakfast:5,smoking:0,fieldRecordedAt:{breakfast:at-DAY,smoking:at}}},
        healthEntries:[{note:'오늘의 메모',updatedAt:{seconds:at/1000}}],cautions:[{date:'2026-10-10',reason:'모임 예정',timestamp:at}],
        controlSessions:[{updatedAt:at,drinksList:[{}]}]};
    const result=summarizeTodayActivity(data,at);
    assert.equal(result.entries.filter(e=>e.category==='craving').length,1,'active challenge entries are not duplicated');
    assert.deepEqual([...result.categories].sort(),['action','body','caution','control','craving','health','medication','smoking','state']);
    assert.match(result.text,/기분 0\/10/); assert.match(result.text,/70kg/); assert.match(result.text,/흡연량 0\/10/);
    assert(!result.text.includes('아침')); assert(!result.text.includes('어제'));
    assert.equal(summarizeTodayActivity(data,at+DAY).text,'');
    assert.equal(summarizeTodayActivity({dailyLogs:{today:{updatedAt:at,smoking:0,breakfast:0}}},at).text,'');
    assert.equal(summarizeTodayActivity({cravings:[{timestamp:at+DAY,reason:'미래'}]},at).text,'');
});

test('streak comparison separates the fixed gap from the live duration and survives sorting', async () => {
    const {compareStreakRecords,formatRecordDuration}=await modulePromise;
    const previous={ordinal:1,startMs:at-20*DAY,endMs:at-10*DAY,durationMs:10*DAY};
    const current={ordinal:2,isCurrent:true,isActive:true,startMs:at-5*DAY,durationMs:5*DAY};
    let value=compareStreakRecords([current,previous],at);
    assert.equal(value.gapMs,5*DAY); assert.equal(value.difference,-5*DAY);
    assert.equal(value.differenceText,'앞선 기록보다 5일 0시간 0분 0초 짧음');
    assert.match(compareStreakRecords([previous,current],at+1000).differenceText,/4일 23시간 59분 59초/);
    assert.match(compareStreakRecords([current,previous],at+5*DAY+1000).differenceText,/0일 0시간 0분 1초 더 유지/);
    assert.equal(compareStreakRecords([current],at),null);
    assert.equal(formatRecordDuration(DAY+3600000+60000+1000),'1일 1시간 1분 1초');
});

test('streak modal updates both neighbor gaps in place and reselects neighbors on an overtake', async t => {
    const m=await modulePromise;
    const dom=new JSDOM(html,{url:'https://fixture.invalid',runScripts:'outside-only'});t.after(()=>dom.window.close());
    const w=dom.window;w.document.getElementById('streakRecordsModal').hidden=false;
    w.Date.now=()=>at;
    Object.assign(w,{formatRecordDuration:m.formatRecordDuration,getStreakRankContext:m.getStreakRankContext,
        hrEl:id=>w.document.getElementById(id),streakRecordsRows:[
            {originalIndex:0,startMs:at-20*DAY,endMs:at-10*DAY,durationMs:10*DAY},
            {originalIndex:1,startMs:at-9*DAY,endMs:at-6*DAY,durationMs:3*DAY},
            {originalIndex:2,isCurrent:true,isActive:true,startMs:at-5*DAY,durationMs:5*DAY}],
        streakRecordsSort:{key:'rank',direction:'asc'}});
    for(const name of ['formatStreakRecordDate','getSortedAccumulatedRecords','refreshStreakLiveRows','renderStreakRecords'])w.eval(extract(name));
    w.eval(extract('sortStreakRecords',true));
    w.renderStreakRecords();const node=w.document.querySelector('[data-streak-live]');
    w.refreshStreakLiveRows(at);assert.equal(node.textContent,'5일 0시간 0분 0초');
    w.refreshStreakLiveRows(at+1000);assert.equal(node.textContent,'5일 0시간 0분 1초');
    assert.equal(node,w.document.querySelector('[data-streak-live]'));
    assert.match(w.document.querySelector('[data-streak-difference="0"]').textContent,/4일 23시간 59분 59초 짧음/);
    assert.match(w.document.querySelector('[data-streak-difference="1"]').textContent,/2일 0시간 0분 1초 더 길음/);
    assert.equal(w.document.querySelector('.streak-gap-row').nextElementSibling.className,'is-current');
    w.sortStreakRecords('start');
    assert.equal(w.document.querySelectorAll('[data-streak-difference]').length,2);
    w.refreshStreakLiveRows(at+5*DAY+1000);
    assert.match(w.document.getElementById('streakRecordsSummary').textContent,/현재 1위/);
    assert.equal(w.document.querySelectorAll('[data-streak-record]').length,2,'new 1st retains 2nd and removes distant 3rd');
    assert.match(w.document.querySelector('[data-streak-difference="0"]').textContent,/0일 0시간 0분 1초 더 길음/);
    assert.equal(w.document.querySelector('[data-streak-difference="1"]'),null);
    w.streakRecordsRows=[];w.document.getElementById('streakRecordsSummary').textContent='불러오는 중';
    w.refreshStreakLiveRows(at);assert.equal(w.document.getElementById('streakRecordsSummary').textContent,'불러오는 중');
});

test('rank comparison includes only adjacent duration ranks for first, middle and last, including shorter-than-current records',async()=>{
    const {getStreakRankContext:context}=await modulePromise;
    const past=[40,25,10,2].map((days,i)=>({id:'past'+i,originalIndex:i,startMs:at-(400-i*70)*DAY,endMs:at-(400-i*70-days)*DAY,durationMs:days*DAY}));
    const active=days=>({id:'current',originalIndex:4,isCurrent:true,isActive:true,startMs:at-days*DAY,durationMs:days*DAY});
    for(const [days,rank,expected] of [[45,1,['current','past0']],[20,3,['past1','current','past2']],[3,4,['past2','current','past3']]]){
        const result=context([...past,active(days)].reverse(),at);
        assert.equal(result.current.durationRank,rank);assert.deepEqual(result.neighbors.map(r=>r.id),expected);
        for(const row of result.neighbors){assert.equal(row.difference,days*DAY-row.durationMs);if(!row.isCurrent)assert.equal(row.gapMs,at-days*DAY-row.endMs);}
    }
    assert.deepEqual(context([...past,active(1)],at).neighbors.map(r=>r.id),['past3','current']);
    assert.equal(context([active(5)],at).neighbors.length,1);assert.equal(context(past,at).current,null);
});

test('shared ranks keep all tied neighbors, use the next actual rank and move at the exact duration boundary',async()=>{
    const {getStreakRankContext:context}=await modulePromise;
    const rows=[10,5,5,2].map((days,i)=>({id:'p'+i,originalIndex:i,startMs:at-(100-i*20)*DAY,endMs:at-(100-i*20-days)*DAY,durationMs:days*DAY}));
    rows.push({id:'current',originalIndex:4,isCurrent:true,isActive:true,startMs:at-5*DAY,durationMs:5*DAY});
    const tied=context(rows,at);assert.equal(tied.current.durationRank,2);assert(tied.current.tiedRank);
    assert.deepEqual(tied.neighbors.map(r=>r.durationRank),[1,2,2,2,5]);
    assert(tied.neighbors.filter(r=>r.id==='p1'||r.id==='p2').every(r=>r.difference===0));
    const before=context(rows,at-1),after=context(rows,at+1);
    assert.equal(before.current.durationRank,4);assert.equal(after.current.durationRank,2);assert.equal(after.current.tiedRank,false);
    assert.deepEqual(after.neighbors.map(r=>r.id),['p0','current','p1','p2']);
    assert.notEqual(tied.key,after.key);
});

test('badge uses elapsed-time rank instead of rounded day qualification and excludes invalid or missing history',async t=>{
    const m=await modulePromise,dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
    w.getStreakRankContext=m.getStreakRankContext;
    for(const name of ['getChallengeRecordRange','getStreakRecordInfo'])w.eval(extract(name));
    const rows=[{id:'prior',startDate:at-20*DAY,endDate:at-15*DAY,status:'failed'},
        {id:'short',startDate:at-10*DAY,endDate:at-9*DAY,status:'failed'},
        {id:'invalid',startDate:at-100*DAY,endDate:at-101*DAY,status:'failed'},
        {id:'missing',startDate:at-100*DAY,status:'failed',hasRecordedEndDate:false},
        {id:'future',startDate:at+DAY,status:'active'},
        {id:'current',startDate:at-5*DAY+1000,status:'active'}];
    const info=w.getStreakRecordInfo(4,rows,'current',null,at);
    assert.equal(info.rank,2);assert.equal(info.totalRecords,3);assert.equal(info.records.length,6);
    assert.equal(w.getStreakRecordInfo(5,rows,'current',null,at+1000).tiedRank,true);
    assert.equal(w.getStreakRecordInfo(5,rows,'current',null,at+2000).rank,1);
    assert.equal(w.getStreakRecordInfo(5,rows.filter(r=>r.id!=='current'),'current',null,at),null,'deleted current not resurrected');
    assert.equal(w.getStreakRecordInfo(5,[],'current',at-5*DAY,at).rank,1,'timer fallback only when explicitly supplied');
});

test('streak async read ignores closed dialogs and changed account generations',async t=>{
    const m=await modulePromise,dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
    let finish,renders=0;
    Object.assign(w,{userId:'owner',currentChallengeId:'current',hr:{generation:1},db:{},streakRecordsRows:[],streakRecordsSort:{},streakRecordsRequestId:0,
        hrEl:id=>d.getElementById(id),hrSameUser:uid=>uid===w.userId,hrOpen:id=>{d.getElementById(id).hidden=false;},
        collection:()=>({}),getDocs:()=>new Promise(resolve=>{finish=resolve;}),getStreakRankContext:m.getStreakRankContext,
        renderStreakRecords:()=>{renders++;}});
    for(const name of ['normalizeChallengeDoc','getChallengeRecordRange','getStreakRecordInfo'])w.eval(extract(name));
    w.eval(extract('openStreakRecordsModal',true));
    const snapshot={forEach:fn=>fn({id:'current',data:()=>({startDate:new Date(Date.now()-5*DAY).toISOString(),status:'active'})})};
    let stopped=0,prevented=0;
    const request=w.openStreakRecordsModal(5,{stopPropagation(){stopped++;},preventDefault(){prevented++;}});
    assert.equal(stopped,1);assert.equal(prevented,1);w.hr.generation++;finish(snapshot);await request;
    assert.equal(renders,0);assert.equal(w.streakRecordsRows.length,0);
    const closed=w.openStreakRecordsModal(5);d.getElementById('streakRecordsModal').hidden=true;finish(snapshot);await closed;assert.equal(renders,0);
    const valid=w.openStreakRecordsModal(5);finish(snapshot);await valid;assert.equal(renders,1);assert.equal(w.streakRecordsRows.length,1);
});

test('floating craving disclosure manages focus, mutual exclusion, Escape, and original modal actions', t => {
    const dom=new JSDOM(html,{url:'https://fixture.invalid',runScripts:'outside-only'});t.after(()=>dom.window.close());
    const w=dom.window,d=w.document,opened=[],alerts=[];
    Object.assign(w,{userId:'owner',auth:{currentUser:{uid:'owner'}},currentChallengeId:'challenge',
        closeFloatingQuickNav(){},openModal:id=>opened.push(id),openActionModal:()=>opened.push('actionModal'),alert:text=>alerts.push(text)});
    w.eval(extract('openCravingQuickAction',true));
    w.eval(fs.readFileSync(path.join(root,'floating-actions.js'),'utf8'));
    d.getElementById('floatingActionToggle').click();d.getElementById('floatingCravingToggle').click();
    assert.equal(d.getElementById('floatingActionToggle').getAttribute('aria-expanded'),'false');
    assert.equal(d.getElementById('floatingCravingItems').inert,false);
    const button=d.getElementById('floatingCravingRecord');
    button.addEventListener('click',()=>{assert.equal(d.activeElement.id,'floatingCravingToggle');w.openCravingQuickAction('record');});
    button.focus();button.click();assert.deepEqual(opened,['cravingModal']);
    assert.equal(d.getElementById('floatingCravingItems').inert,true);
    w.openCravingQuickAction('action');assert.deepEqual(opened,['cravingModal','actionModal']);
    w.currentChallengeId=null;w.openCravingQuickAction('record');assert.equal(alerts.length,1);
    d.getElementById('floatingCravingToggle').click();
    d.getElementById('floatingCravingAction').focus();
    d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(d.activeElement.id,'floatingCravingToggle');
    assert.equal(d.getElementById('floatingCravingToggle').getAttribute('aria-expanded'),'false');
});
