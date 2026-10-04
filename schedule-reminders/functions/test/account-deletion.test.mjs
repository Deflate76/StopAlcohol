import test from 'node:test';
import assert from 'node:assert/strict';
import {fakeFirestore} from './fake-firestore.mjs';
import {createAccountDeletionService, deletionJobRef} from '../account-deletion.mjs';

function fixture() {
  const db = fakeFirestore(), files = new Set(), users = new Map(), calls = [];
  let clock = 1800000000000, deny = false, failStorage = false;
  db.recursiveDelete = async ref => {
    for (const path of db.data.keys()) if (path === ref.path || path.startsWith(ref.path+'/')) db.data.delete(path);
  };
  users.set('alice',{uid:'alice',disabled:false,tokensValidAfterTime:new Date(clock-10000).toISOString()});
  users.set('alice2',{uid:'alice2',disabled:false});
  const auth = {
    getUser:async uid => { if (!users.has(uid)) throw {code:'auth/user-not-found'}; return users.get(uid); },
    updateUser:async(uid,value) => { calls.push(['disable',uid]); if (!users.has(uid)) throw {code:'auth/user-not-found'}; Object.assign(users.get(uid),value); },
    revokeRefreshTokens:async uid => { calls.push(['revoke',uid]); },
    deleteUser:async uid => { calls.push(['delete',uid]); users.delete(uid); }
  };
  const bucket = {getFiles:async({prefix,maxResults}) => {
    if (failStorage) throw new Error('storage unavailable');
    return [[...files].filter(path=>path.startsWith(prefix)).slice(0,maxResults).map(path=>({delete:async()=>files.delete(path)}))];
  }};
  const service = createAccountDeletionService({db,auth,bucket,now:()=>clock,
    checkPermissions:async()=>{if(deny)throw new Error('missing permissions');}});
  const request = () => ({auth:{uid:'alice',token:{auth_time:clock/1000,firebase:{sign_in_provider:'google.com'}}},data:{confirm:true}});
  return {db,files,users,calls,service,request, advance:ms=>clock+=ms, permissions:value=>deny=value, storageFailure:value=>failStorage=value};
}
test('deletion requires explicit confirmation, fresh authentication, and never accepts another uid/path',async()=>{
  const f=fixture();
  for(const request of [{data:{confirm:true}}, {...f.request(),data:{}}, {...f.request(),data:{confirm:true,uid:'alice2'}},
    {...f.request(),data:{confirm:true,path:'users/alice2'}},
    {...f.request(),auth:{uid:'alice',token:{auth_time:1}}},
    {...f.request(),auth:{uid:'alice',token:{auth_time:1800000000,firebase:{sign_in_provider:'anonymous'}}}}]) {
    await assert.rejects(f.service.api(request));
  }
  assert.equal(f.db.data.size,0);assert.equal(f.calls.length,0);
});
test('missing permissions changes no data, account state, or files',async()=>{
  const f=fixture();f.db.data.set('users/alice',{nickname:'Alice'});f.files.add('health_records/alice/1.jpg');f.permissions(true);
  await assert.rejects(f.service.api(f.request()),error=>error.code==='failed-precondition');
  assert.equal(f.db.data.size,1);assert.equal(f.calls.length,0);assert.equal(f.files.size,1);
});
test('deletes all pages, orphan descendants, photos, comments, reminders and auth; preserves other members',async()=>{
  const f=fixture();
  for(const root of ['users','daily_schedule_accounts','daily_wisdom_accounts']) {
    f.db.data.set(`${root}/alice/nested/orphan/deeper/record`,{private:true});
    f.db.data.set(`${root}/alice2/nested/keep`,{private:true});
  }
  for(const [collection,field] of [['fcmTokens','uid'],['daily_schedule_devices','uid'],['daily_schedule_queue','uid'],['drinking_sessions','userId'],['posts','uid']]) {
    for(let i=0;i<125;i++)f.db.data.set(`${collection}/delete${i}`,{[field]:'alice'});
    f.db.data.set(`${collection}/keep`,{[field]:'alice2'});
  }
  for(let i=0;i<125;i++)f.db.data.set(`posts/other${String(i).padStart(3,'0')}`,{uid:'alice2',comments:[{uid:'alice',text:'remove'},{uid:'alice2',text:'keep'}]});
  for(const root of ['health_records','pill_identification'])for(let i=0;i<125;i++)f.files.add(`${root}/alice/${i}/front.jpg`);
  f.files.add('health_records/alice2/keep.jpg');
  const result=await f.service.api(f.request());assert.equal(result.deleted,true);
  assert.equal(f.users.has('alice'),false);assert.equal(f.users.has('alice2'),true);
  assert.deepEqual([...f.files],['health_records/alice2/keep.jpg']);
  for(const [path,value]of f.db.data) {
    if(path===deletionJobRef(f.db,'alice').path)continue;
    assert.ok(!path.includes('/alice/'));assert.notEqual(value.uid,'alice');assert.notEqual(value.userId,'alice');
    if(value.comments)assert.deepEqual(value.comments,[{uid:'alice2',text:'keep'}]);
  }
  assert.equal(f.calls.at(-1)[0],'delete');
  // A stale tab/in-flight upload can finish before its old ID token expires.
  f.db.data.set('users/alice/health_entries/late',{private:true});f.files.add('health_records/alice/late.jpg');
  f.advance(71*60000);await f.service.dispatch();
  assert.equal(f.db.data.has('users/alice/health_entries/late'),false);
  assert.equal(f.db.data.has(deletionJobRef(f.db,'alice').path),false);
  assert.equal(f.files.has('health_records/alice/late.jpg'),false);
});
test('interrupted cleanup stays queued and resumes without another user action',async()=>{
  const f=fixture();f.storageFailure(true);f.files.add('health_records/alice/1.jpg');f.db.data.set('users/alice/private/1',{health:true});
  assert.deepEqual(await f.service.api(f.request()),{accepted:true,deleted:false});
  assert.equal(f.users.get('alice').disabled,true);assert.ok(f.db.data.has(deletionJobRef(f.db,'alice').path));
  assert.equal(f.calls.some(([action])=>action==='delete'),false);
  f.storageFailure(false);f.advance(3*60000);await f.service.dispatch();
  assert.equal(f.users.has('alice'),false);assert.equal(f.files.size,0);assert.equal(f.db.data.has('users/alice/private/1'),false);
});
test('another account taking ownership of a push token is preserved during cleanup',async()=>{
  const f=fixture();f.db.data.set('fcmTokens/shared',{uid:'alice'});
  const transaction=f.db.runTransaction;let reassigned=false;
  f.db.runTransaction=async callback=>transaction(async tx=>callback({...tx,get:async ref=>{
    if(ref.path==='fcmTokens/shared'&&!reassigned){f.db.data.set(ref.path,{uid:'alice2'});reassigned=true;}
    return tx.get(ref);
  }}));
  await f.service.api(f.request());assert.equal(f.db.data.get('fcmTokens/shared').uid,'alice2');
});
