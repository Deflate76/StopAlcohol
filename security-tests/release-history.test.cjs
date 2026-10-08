const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const modulePromise=import(pathToFileURL(path.join(root,'release-history.js')));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sha='a'.repeat(40),other='b'.repeat(40);
const row=(number,commit=sha)=>({id:`${number}-1`,version:`v${number}`,number,attempt:1,commit,deployedAt:'2026-10-05T08:00:00Z',title:`업데이트 ${number}`,changes:['달력 보기 개선']});
const envelope=releases=>({schemaVersion:1,releases});
function fixture(t){const dom=new JSDOM(html,{url:'https://www.alcoholaway.com',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;const dialog=d.getElementById('releaseHistoryModal');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new w.Event('close'));};return{w,d,dialog};}
const response=value=>({ok:true,json:async()=>value});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('release metadata rejects invalid identifiers and formats dates in Korean time',async()=>{
    const {normalizeHistory,formatReleaseDate}=await modulePromise;
    const records=normalizeHistory(envelope([row(2),row(1),row(2),{...row(3),commit:'not-sha'},{...row(4),id:'../../index'}]));
    assert.deepEqual(records.map(r=>r.version),['v2','v1']);
    assert.equal(records[0].detailPath,'versions/2-1.json');
    const rerun={...row(1),id:'1-2',version:'v1.2',attempt:2,deployedAt:'2026-10-06T08:00:00Z'};
    assert.equal(normalizeHistory(envelope([row(2),rerun]))[0].version,'v1.2');
    assert.equal(formatReleaseDate('2026-10-04T15:10:00Z'),'2026. 10. 05.');
    assert.throws(()=>normalizeHistory({releases:[]}));
});

test('version follows the actual served build; dialog searches, pages, and safely displays details',async t=>{
    const {installReleaseHistory}=await modulePromise;const{w,d,dialog}=fixture(t);
    const rows=Array.from({length:15},(_,i)=>row(20-i,i<2?other:sha));rows[2].title='<img src=x onerror=alert(1)>';
    let detailsRequests=0;
    const fetcher=async url=>{
        if(url==='./app-build.json')return response({commit:sha});
        if(url==='./release-history-seed.json')return response(envelope([]));
        if(url.includes('/index.json'))return response(envelope(rows));
        detailsRequests++;return response({...rows[2],commits:[{sha,message:'세부 내용\n<script>alert(1)</script>'}],files:[{path:'index.html',status:'modified',additions:4,deletions:2}],comparisonUrl:'javascript:alert(1)'});
    };
    await installReleaseHistory({doc:d,win:w,fetcher}).ready;
    assert.equal(d.getElementById('appVersionLabel').textContent,'v18');
    assert.equal(d.querySelectorAll('.release-current-badge').length,1);
    d.getElementById('appVersionLabel').click();assert(dialog.open);
    assert.equal(d.querySelectorAll('.release-card').length,12);
    d.getElementById('releaseHistoryMore').click();assert.equal(d.querySelectorAll('.release-card').length,15);
    const search=d.getElementById('releaseHistorySearch');search.value='v18';search.dispatchEvent(new w.Event('input'));
    assert.equal(d.querySelectorAll('.release-card').length,1);assert.equal(d.querySelector('.release-card h3 img'),null);
    const expand=d.querySelector('.release-expand');expand.open=true;expand.dispatchEvent(new w.Event('toggle'));await tick();
    assert.equal(detailsRequests,1);assert.match(d.querySelector('.release-message').textContent,/<script>/);
    assert.equal(d.querySelector('.release-detail-content script'),null);assert.equal(d.querySelector('[href^="javascript:"]'),null);
    assert.match(d.querySelector('.release-files').textContent,/수정 · index.html/);
    d.getElementById('releaseHistoryClose').click();assert(!dialog.open);assert.equal(d.activeElement.id,'appVersionLabel');
});

test('archive failures keep local history, detail retry works, and a new deployment refreshes the label',async t=>{
    const {installReleaseHistory}=await modulePromise;const{w,d}=fixture(t);let online=false,detailOnline=false;
    const old=row(8,other),latest=row(9);let fetched=[];
    const fetcher=async url=>{
        fetched.push(url);
        if(url==='./app-build.json')return response({commit:sha});
        if(url==='./release-history-seed.json')return response(envelope([old]));
        if(url.includes('/index.json')){if(!online)throw Error('offline');return response(envelope([latest,old]));}
        if(!detailOnline)throw Error('offline');return response({...latest,commits:[],files:[],message:'새 기능'});
    };
    const app=installReleaseHistory({doc:d,win:w,fetcher});await app.ready;
    assert.equal(d.getElementById('appVersionLabel').textContent,'빌드 aaaaaaa');
    assert.match(d.getElementById('releaseHistoryStatus').textContent,/저장된 이력/);
    online=true;await app.refresh(true);assert.equal(d.getElementById('appVersionLabel').textContent,'v9');
    const expand=d.querySelector('.release-expand');expand.open=true;expand.dispatchEvent(new w.Event('toggle'));await tick();
    assert.match(expand.textContent,/다시 불러오기/);detailOnline=true;expand.querySelector('button').click();await tick();
    assert.match(expand.textContent,/새 기능/);assert(fetched.every(url=>!url.includes('api.github.com')));
    assert.match(w.localStorage.getItem('alcoholaway:public-release-history:v1'),/v9/);
});
