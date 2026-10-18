const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const mod=f=>import(pathToFileURL(path.join(root,f))),tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function fixture(t,extra={}) {
    const {installDiagnosisPhotos}=await mod('diagnosis-photos.js');
    const dom=new JSDOM(html,{url:'https://test.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,d=w.document;
    t.after(()=>dom.window.close());let count=0,owner='a',records=[],uploaded=[],revoked=[],locks=[];
    const target={id:'one'},ctx={uid:'a',target,date:'2026-10-18',validDate:true};
    w.URL.createObjectURL=()=>`blob:private-${++count}`;w.URL.revokeObjectURL=url=>revoked.push(url);w.confirm=()=>true;w.prompt=()=>'<img onerror=1>';
    const api={document:d,context:()=>owner===ctx.uid?ctx:null,rows:()=>records,loaded:()=>true,error:()=>null,
        ensureTarget:async()=>{},consent:async()=>true,newId:()=>String(++count),prepare:async()=>({size:100,type:'image/jpeg'}),
        upload:async(c,id,item)=>{uploaded.push({id,label:item.label,date:item.date});records.push({id,label:item.label,date:item.date,status:'ready',createdAtClient:'2026-10-18T00:00:00Z'});},
        read:async()=>({size:100}),rename:async(c,row,label)=>{row.label=label;},remove:async(c,row)=>{records=records.filter(r=>r.id!==row.id);},setBusy:v=>locks.push(v),...extra};
    const ui=installDiagnosisPhotos(api);
    return {w,d,ui,api,ctx,uploaded,revoked,locks,setOwner:v=>owner=v,setRows:v=>records=v,el:id=>d.getElementById(id),confirm:()=>{d.getElementById('diagnosisPhotoConfirmed').checked=true;d.getElementById('diagnosisPhotoConfirmed').dispatchEvent(new w.Event('change'));}};
}

test('photo album IDs isolate similar/legacy diagnosis IDs; full timestamps determine chronological order',async()=>{
    const {diagnosisPhotoPrefix:prefix,diagnosisPhotoRows:rows}=await mod('diagnosis-photos.js');
    const data=[{id:prefix('one')+'a',date:'2026-10-17',createdAtClient:'2026-10-17T14:00Z'},
        {id:prefix('one_more')+'a',date:'2026-10-18'}, {id:prefix('one')+'b',date:'2026-10-17',createdAtClient:'2026-10-17T15:00Z'},
        {id:'ordinary-photo',date:'2026-10-18'}];
    assert.deepEqual(rows(data,'one').map(x=>x.id),[prefix('one')+'b',prefix('one')+'a']);
    assert.equal(rows(data,'one',true)[0].id,prefix('one')+'a');assert.throws(()=>prefix('../other'));
});
test('multiple photos have independent captions, no total count cap, explicit privacy confirmation, and successful saves clear drafts',async t=>{
    const f=await fixture(t);await f.ui.add(Array.from({length:25},()=>({})));
    assert.equal(f.d.querySelectorAll('.diagnosis-photo-draft').length,25);
    await f.ui.save();assert.equal(f.uploaded.length,0);
    const field=f.d.querySelector('.diagnosis-photo-draft textarea');field.value='<img src=x onerror=1>';field.dispatchEvent(new f.w.Event('input'));
    f.confirm();await f.ui.save();await tick();
    assert.equal(f.uploaded.length,25);assert.equal(f.uploaded[0].label,'<img src=x onerror=1>');
    assert.equal(f.d.querySelectorAll('.diagnosis-photo-draft').length,0);assert.equal(f.d.querySelectorAll('.diagnosis-photo-card').length,12);
    assert.equal(f.d.querySelector('#diagnosisPhotoList [onerror]'),null);assert.equal(f.locks.at(-1),false);
    [...f.el('diagnosisPhotoList').querySelectorAll('button')].find(b=>b.textContent.includes('사진 더 보기')).click();await tick();
    assert.equal(f.d.querySelectorAll('.diagnosis-photo-card').length,24);
});
test('partial upload failure preserves remaining drafts and retries the identical object ID without duplicating completed photos',async t=>{
    let calls=[],failed=false;const f=await fixture(t,{upload:async(c,id,item)=>{calls.push(id);if(calls.length===2&&!failed){failed=true;throw Error('offline');}}});
    await f.ui.add([{}, {}, {}]);f.confirm();await f.ui.save();
    assert.equal(f.d.querySelectorAll('.diagnosis-photo-draft').length,2);assert.match(f.el('diagnosisPhotoStatus').textContent,/그대로/);
    await f.ui.save();assert.equal(calls[1],calls[2]);assert.equal(new Set(calls).size,3);assert.equal(f.d.querySelectorAll('.diagnosis-photo-draft').length,0);
});
test('late image decode and downloads cannot display previous-account photos; closing revokes all preview URLs',async t=>{
    const wait=deferred();const f=await fixture(t,{prepare:()=>wait.promise});
    const adding=f.ui.add([{}]);f.setOwner('b');f.ui.reset();wait.resolve({size:50});await adding;
    assert.equal(f.d.querySelectorAll('.diagnosis-photo-draft').length,0);
    f.setOwner('a');f.api.prepare=async()=>({size:1}); // The installed callback remains the already resolved promise.
    await f.ui.add([{}]);assert.equal(f.d.querySelectorAll('.diagnosis-photo-draft').length,1);
    f.w.confirm=()=>false;assert.equal(f.ui.canClose(),false);assert.equal(f.d.querySelectorAll('.diagnosis-photo-draft').length,1);
    assert.equal(f.ui.canClose(true),true);assert(f.revoked.length>0);
    const download=deferred(),g=await fixture(t,{read:()=>download.promise});
    g.setRows([{id:'diagnosis_3_one_file',date:'2026-10-18',status:'ready',label:'private'}]);const reading=g.ui.refresh();
    g.setOwner('b');g.ui.reset();download.resolve({size:10});await reading;assert.equal(g.d.querySelectorAll('#diagnosisPhotoList img').length,0);
});
test('changing accounts during a multi-photo upload prevents all following writes',async t=>{
    const wait=deferred(),calls=[];const f=await fixture(t,{upload:async(c,id)=>{calls.push(c.uid);await wait.promise;}});
    await f.ui.add([{},{}]);f.confirm();const save=f.ui.save();await tick();f.setOwner('b');f.ui.reset();wait.resolve();await save;
    assert.deepEqual(calls,['a']);assert.equal(f.el('diagnosisPhotoList').children.length,0);
});
test('camera permission completing after close stops every track and never reopens preview',async t=>{
    const wait=deferred(),f=await fixture(t);let stopped=0;
    Object.defineProperty(f.w.navigator,'mediaDevices',{value:{getUserMedia:()=>wait.promise}});
    f.el('diagnosisPhotoCamera').click();f.ui.reset();wait.resolve({getTracks:()=>[{stop:()=>stopped++}]});await tick();
    assert.equal(stopped,1);assert(f.el('diagnosisCamera').hidden);
});
test('real Firebase adapter checks account, album and live consent; pending uploads retry without new documents',async t=>{
    const {diagnosisPhotoPrefix}=await mod('diagnosis-photos.js');
    const dom=new JSDOM(html,{runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;t.after(()=>dom.window.close());
    const records=new Map(),writes=[],uploads=[],consent={status:'granted',version:'v2',personal:true,sensitive:true};
    const target={entryId:'entry',index:0,name:'위염',date:'2026-10-01',id:'stable',legacy:true},ctx={uid:'a',target};
    let owner='a',fail=true;
    records.set('users/a/health_entries/entry',{diagnoses:[{name:'위염',date:'2026-10-01'}]});
    records.set('users/a/health_consents/health',consent);records.set('users/a/health_consents/photos',consent);
    const get=async ref=>({exists:()=>records.has(ref.path),data:()=>records.get(ref.path)});
    const set=async(ref,data)=>{writes.push(ref.path);records.set(ref.path,data);};
    const update=async(ref,data)=>set(ref,{...records.get(ref.path),...data});
    Object.assign(w,{hr:{uid:'a',diaryTarget:target,entries:[{id:'entry',...records.get('users/a/health_entries/entry')}],photos:[]},db:{},hrStorage:{},HR_POLICY_VERSION:'v2',HR_PHOTO_MAX_BYTES:4194304,
        hrSameUser:uid=>owner===uid,hrEl:id=>w.document.getElementById(id),diagnosisPhotoPrefix,hrRecordConflict:message=>Error(message),
        installDiagnosisPhotos:config=>config,doc:(db,...p)=>({path:p.join('/')}),serverTimestamp:()=>1,
        runTransaction:async(db,fn)=>fn({get,update,set}),getDoc:get,setDoc:set,updateDoc:update,storageRef:(storage,path)=>({path}),
        hrPhotoPath:(uid,id)=>`health_records/${uid}/${id}.jpg`,hrRequireConsent:async()=>true,
        uploadBytesResumable:(ref,blob)=>{uploads.push(ref.path);const p=fail?Promise.reject(Error('offline')):Promise.resolve();p.on=()=>{};return p;}});
    const start=html.indexOf('    function hrPhotoDiaryCurrent('),end=html.indexOf('    window.dateToKeyForHealthToday',start);
    w.eval(html.slice(start,end).replace('const diagnosisPhotos = installDiagnosisPhotos','window.adapter = installDiagnosisPhotos'));
    await w.adapter.ensureTarget(ctx);assert.equal(target.legacy,false);assert.equal(records.get('users/a/health_entries/entry').diagnoses[0].id,'stable');
    const id=diagnosisPhotoPrefix('stable')+'file',item={date:'2026-10-18',label:'설명',blob:{size:200}};
    await assert.rejects(w.adapter.upload(ctx,id,item,()=>{}),/offline/);
    assert.equal(records.get('users/a/prescription_photos/'+id).status,'uploading');
    fail=false;await w.adapter.upload(ctx,id,item,()=>{});assert.equal(records.get('users/a/prescription_photos/'+id).status,'ready');
    await w.adapter.upload(ctx,id,{...item,label:'다시 수정'},()=>{});assert.equal(uploads.length,2);assert.equal(records.get('users/a/prescription_photos/'+id).label,'다시 수정');
    const before=writes.length;owner='b';await assert.rejects(w.adapter.upload(ctx,id,item,()=>{}),/계정/);assert.equal(writes.length,before);
    owner='a';await assert.rejects(w.adapter.upload(ctx,'diagnosis_5_other_file',item,()=>{}),/계정 또는 질환/);
    records.set('users/a/health_consents/photos',{...consent,status:'revoked'});
    await assert.rejects(w.adapter.ensureTarget(ctx),/동의 상태/);
});
test('photo errors remain visible; descriptions are plain text; deleting a photo releases its cached URL',async t=>{
    const f=await fixture(t);f.setRows([{id:'diagnosis_3_one_a',date:'2026-10-18',status:'ready',label:'old'}]);await f.ui.refresh();
    [...f.el('diagnosisPhotoList').querySelectorAll('button')].find(b=>b.textContent==='설명 수정').click();await tick();
    assert.match(f.el('diagnosisPhotoList').textContent,/<img onerror=1>/);assert.equal(f.d.querySelector('#diagnosisPhotoList [onerror]'),null);
    [...f.el('diagnosisPhotoList').querySelectorAll('button')].find(b=>b.textContent==='사진 삭제').click();await tick();
    assert.equal(f.d.querySelectorAll('.diagnosis-photo-card').length,0);assert(f.revoked.length);
});
test('sobriety popup substitutes actual values, shares the rounded badge value, and explains missing official comparable averages',async t=>{
    const {renderSobrietyDetails}=await mod('sobriety-details.js'),{calculateSobrietyRate}=await mod('sobriety-metrics.js');
    const dom=new JSDOM(html);t.after(()=>dom.window.close());const d=dom.window.document;
    const data=calculateSobrietyRate({createdAt:'2026-10-01',now:'2026-10-10',challenges:[{startDate:'2026-10-02'}],dailyLogs:{'2026-10-03':{alcohol:3},'2026-10-04':{alcohol:2}}});
    renderSobrietyDetails(d,data);assert.match(d.getElementById('sobrietyRateDetails').textContent,/\(9 − 2\) ÷ 9 × 100 = 77.78% → 78%/);
    assert.match(d.querySelector('.sobriety-rate-bar').getAttribute('aria-label'),/금주 7일, 음주 기록 2일/);
    assert.equal(d.querySelector('.sobriety-rate-bar>span').style.width,'77.77777777777779%');
    assert.match(d.querySelector('.sobriety-comparison').textContent,/확인하지 못했습니다/);
    renderSobrietyDetails(d,null,{loading:true});assert.match(d.getElementById('sobrietyRateDetails').textContent,/불러오고/);assert.equal(d.querySelector('.sobriety-rate-number'),null);
    renderSobrietyDetails(d,null,{error:true});assert.match(d.getElementById('sobrietyRateDetails').textContent,/계산할 수 없습니다/);
});
test('diagnoses show current treatment first and recovered rows in a default-closed group that preserves expansion',async t=>{
    const dom=new JSDOM(html,{runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;t.after(()=>dom.window.close());
    Object.assign(w,{hr:{uid:'a',loaded:{health:true},errors:{},entries:[{id:'e',diagnoses:[{id:'a',date:'2026-10-17',name:'회복됨',recoveredDate:'2026-10-18'},{id:'b',date:'2026-10-10',name:'치료중'},{id:'f',date:'2026-11-01',name:'미래'}]}]},
        hrEl:id=>w.document.getElementById(id),hrToday:()=> '2026-10-18',hrDayNumber:d=>Date.parse(d)/86400000,
        hrValidDate:()=>true,hrRecoveryDetails:r=>r.recoveredDate?{date:r.recoveredDate,label:'회복'}:null,
        hrRefreshMinAbstinenceProgress(){},recordSectionUI:{setDiagnosisNames(){}},escapeHtml:s=>s,
        hrSameUser:()=>true,hrAbstinencePlan:()=>null});
    const start=html.indexOf('    function hrRenderDiagnoses() {'),end=html.indexOf('\n    // Minimum abstinence',start);w.eval(html.slice(start,end));w.hrRenderDiagnoses();
    assert.match(w.document.querySelector('#diagnosisRecordList > .diagnosis-row').textContent,/치료중/);
    const group=w.document.querySelector('.diagnosis-recovered-group');assert.equal(group.open,false);assert.equal(group.querySelectorAll('.is-recovered').length,1);
    group.open=true;w.hrRenderDiagnoses();assert.equal(w.document.querySelector('.diagnosis-recovered-group').open,true);
});
