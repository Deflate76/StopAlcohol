const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const load=import(pathToFileURL(path.join(root,'account-deletion.js')));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function fixture(t,{error=null,pending=false}={}) {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const dialog=html.match(/<dialog id="deleteAccountDialog"[\s\S]*?<\/dialog>/)[0];
  const dom=new JSDOM('<button id="deleteAccountBtn">탈퇴</button>'+dialog,{url:'https://fixture.invalid'});
  t.after(()=>dom.window.close());
  const doc=dom.window.document,dialogEl=doc.querySelector('dialog');
  dialogEl.showModal=()=>dialogEl.open=true;dialogEl.close=()=>dialogEl.open=false;
  const calls=[],user={uid:'alice',getIdToken:async()=>calls.push('token')},auth={currentUser:user};
  const win={localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    alert:message=>calls.push(['alert',message]),location:{pathname:'/',replace:()=>calls.push('reload'),reload:()=>calls.push('reload')}};
  const {installAccountDeletion}=await load;
  const ui=installAccountDeletion({dom:doc,win,auth,functions:{},googleProvider:{},
    httpsCallable:()=>async data=>{calls.push(data);if(error)throw error;return{data:data.action?{ready:true}:{accepted:true,deleted:!pending}};},
    reauthenticateWithPopup:async()=>calls.push('reauth'),quiesce:()=>calls.push('quiesce'),
    signOut:async()=>{calls.push('signout');auth.currentUser=null;},clearPushToken:async()=>calls.push('push-clear')});
  return{doc,ui,calls,auth,win,click:id=>doc.getElementById(id).click()};
}
test('cancel keeps the account intact; confirmation reauthenticates before any deletion',async t=>{
  const f=await fixture(t);f.click('deleteAccountBtn');f.click('cancelDeleteAccountBtn');await tick();assert.deepEqual(f.calls,[]);
  f.click('deleteAccountBtn');f.click('confirmDeleteAccountBtn');f.click('confirmDeleteAccountBtn');await tick();
  assert.deepEqual(f.calls.slice(0,5),['reauth','token',{action:'status'},'quiesce',{confirm:true}]);
  assert.equal(f.calls.filter(x=>x?.confirm).length,1);assert.equal(f.auth.currentUser,null);assert.equal(f.calls.at(-1),'reload');
});
test('server setup failure never sends a deletion or signs out and is shown as text',async t=>{
  const f=await fixture(t,{error:{code:'functions/failed-precondition',message:'설정 필요 <img src=x onerror=alert(1)>'}});
  f.click('deleteAccountBtn');f.click('confirmDeleteAccountBtn');await tick();
  assert.ok(!f.calls.some(x=>x?.confirm));assert.equal(f.auth.currentUser.uid,'alice');assert.equal(f.ui.isDeleting(),false);
  assert.equal(f.doc.querySelector('#deleteAccountStatus img'),null);
});
test('accepted background cleanup says pending, clears owned data and signs out',async t=>{
  const f=await fixture(t,{pending:true});f.win.localStorage.setItem('alcoholaway.otc.scan-history.v1.alice','private');
  f.win.localStorage.setItem('alcoholaway.otc.scan-history.v1.alice2','other member');
  f.click('deleteAccountBtn');f.click('confirmDeleteAccountBtn');await tick();
  assert.match(f.calls.find(x=>Array.isArray(x)&&x[0]==='alert')[1],/접수/);
  assert.equal(f.win.localStorage.getItem('alcoholaway.otc.scan-history.v1.alice'),null);
  assert.equal(f.win.localStorage.getItem('alcoholaway.otc.scan-history.v1.alice2'),'other member');
});
test('best rank dates use Korean dates and distinguish completed and ongoing records',async()=>{
  const{formatBestRankRange}=await import(pathToFileURL(path.join(root,'progress-chart.js')));
  const range={startMs:Date.parse('2026-01-01T23:30:00Z'),endMs:Date.parse('2026-03-01T22:30:00Z')};
  assert.equal(formatBestRankRange(range),'(2026.01.02 시작 ~ 2026.03.02 종료)');
  assert.match(formatBestRankRange({...range,isActive:true}),/현재 · 진행중/);
  assert.match(formatBestRankRange({...range,endMs:null}),/종료일 미기록/);
});
