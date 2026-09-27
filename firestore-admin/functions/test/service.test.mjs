import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAdminService,AdminError,AUDIT} from '../service.mjs';
import {administratorAuthorization} from '../authorization.mjs';
import {validateFields,validateValue,parseValue,valueText,canonical,pathParts,diffFields} from '../value-codec.mjs';

const ROOT='projects/alcoholaway/databases/(default)/documents';
const stamp='2026-09-27T04:00:00.123456789Z',later='2026-09-27T05:00:00.987654321Z';
const claim={uid:'admin1',token:{firestoreAdmin:true,auth_time:1790481600}};
const user={uid:'admin1',emailVerified:true,disabled:false,customClaims:{firestoreAdmin:true},tokensValidAfterTime:'2026-09-01T00:00:00Z'};
const call=data=>({app:{appId:'app'},auth:structuredClone(claim),data});
function harness(authorize=async()=>({uid:'admin1'})){
  const docs=new Map(),calls=[],children=new Map();let beforeCommit=null;let queryRows=[];
  function put(path,fields={title:{stringValue:'원본'}},updateTime=stamp){const doc={name:ROOT+'/'+path,fields,updateTime,createTime:stamp};docs.set(path,doc);return doc;}
  const service=createAdminService({authorize,now:()=>stamp,request:async(method,url,body,options)=>{
    calls.push({method,url,body,options});const relative=decodeURIComponent(url.slice(ROOT.length)).replace(/^\//,'');
    if(method==='GET')return structuredClone(docs.get(relative)||null);
    if(url.endsWith(':listCollectionIds'))return {collectionIds:children.get(relative.replace(':listCollectionIds',''))||[]};
    if(url.endsWith(':runQuery'))return queryRows;
    if(url.endsWith(':commit')){
      if(beforeCommit)beforeCommit();
      for(const write of body.writes){const path=(write.delete||write.update.name).slice(ROOT.length+1),existing=docs.get(path);
        if(write.currentDocument.exists===false&&existing)throw new AdminError('already-exists','exists');
        if(write.currentDocument.updateTime&&existing?.updateTime!==write.currentDocument.updateTime)throw new AdminError('failed-precondition','changed');
      }
      for(const write of body.writes){const path=(write.delete||write.update.name).slice(ROOT.length+1);if(write.delete)docs.delete(path);else put(path,structuredClone(write.update.fields),later);}
      return {commitTime:later,writeResults:body.writes.map(()=>({updateTime:later}))};
    }
    throw new Error('Unexpected request: '+method+' '+url);
  }});
  return {service,docs,calls,children,put,setBeforeCommit:value=>beforeCommit=value,setQueryRows:rows=>queryRows=rows};
}
const mutation=(action,path,fields={title:{stringValue:'새 값'}})=>({action,path,fields,confirmPath:path,requestId:randomUUID(),...(action==='create'?{}:{updateTime:stamp})});

test('wire editor preserves int64, nanoseconds, nested values, references and bytes',()=>{
  const fields={big:{integerValue:'9223372036854775807'},time:{timestampValue:stamp},bytes:{bytesValue:'AQID'},ref:{referenceValue:ROOT+'/users/a'},point:{geoPointValue:{latitude:37.5,longitude:127}},nested:{mapValue:{fields:{items:{arrayValue:{values:[{booleanValue:false},{doubleValue:'NaN'},{nullValue:null}]}}}}}};
  validateFields(fields);for(const value of Object.values(fields)){const type=Object.keys(value)[0];assert.equal(canonical(parseValue(type,valueText(value))),canonical(value));}
  assert.deepEqual(diffFields(fields,JSON.parse(JSON.stringify(fields))),[]);
  const proto=JSON.parse('{"__proto__":{"stringValue":"literal field"}}');assert.equal(validateFields(proto).__proto__.stringValue,'literal field');
});
test('invalid integer/timestamp/maps/array nesting and oversized documents are rejected',()=>{
  for(const invalid of [{integerValue:1},{integerValue:'9223372036854775808'},{timestampValue:'2026-02-30T00:00:00Z'},{mapValue:{fields:false}},{arrayValue:{values:[{arrayValue:{values:[]}}]}},{doubleValue:Infinity}])assert.throws(()=>validateValue(invalid));
  assert.throws(()=>validateFields({huge:{stringValue:'a'.repeat(900001)}}));
  assert.throws(()=>pathParts('users//a'));assert.throws(()=>pathParts('users/a/records'));
});
test('authentication rejects missing App Check/auth, non-boolean claim, revoked/disabled and stale accounts',async()=>{
  let reads=0,current=structuredClone(user);const authorize=administratorAuthorization(async()=>{reads++;return current;});
  for(const request of [{auth:claim},{app:{}},{app:{},auth:{...claim,token:{firestoreAdmin:'true'}}}])await assert.rejects(()=>authorize(request));
  assert.equal(reads,0);assert.deepEqual(await authorize(call({})),{uid:'admin1'});
  for(const altered of [{...user,disabled:true},{...user,emailVerified:false},{...user,customClaims:{}},{...user,uid:'other'},{...user,tokensValidAfterTime:'2026-09-28T00:00:00Z'}]){current=altered;await assert.rejects(()=>authorize(call({})));}
  current=user;const badTime=call({});badTime.auth.token.auth_time='bad';await assert.rejects(()=>authorize(badTime));
});
test('authorization runs before any read and is rechecked before every write',async()=>{
  const denied=harness(async()=>{throw new AdminError('permission-denied','denied');});await assert.rejects(()=>denied.service(call({action:'get',path:'users/a'})));assert.equal(denied.calls.length,0);
  let checks=0;const h=harness(async()=>{if(++checks>1)throw new AdminError('permission-denied','revoked');return {uid:'admin1'};});h.put('users/a');await assert.rejects(()=>h.service(call(mutation('update','users/a'))));assert.equal(h.calls.filter(c=>c.url.endsWith(':commit')).length,0);
});
test('update replaces fields atomically with a metadata-only receipt and can be retried',async()=>{
  const h=harness();h.put('users/a',{old:{stringValue:'private original'},removed:{stringValue:'remove'}});const data=mutation('update','users/a',{count:{integerValue:'9223372036854775807'},at:{timestampValue:stamp}});
  const first=await h.service(call(data));assert.equal(first.ok,true);assert.deepEqual(h.docs.get('users/a').fields,data.fields);
  const writes=h.calls.find(c=>c.url.endsWith(':commit')).body.writes;assert.equal(writes.length,2);assert.equal(writes[0].currentDocument.updateTime,stamp);
  const audit=h.docs.get(AUDIT+'/'+data.requestId);assert.deepEqual(Object.keys(audit.fields).sort(),['action','actorUid','at','documentPath','fingerprint','requestId']);assert.ok(!JSON.stringify(audit).includes('private original'));
  const retry=await h.service(call(data));assert.equal(retry.replayed,true);assert.equal(h.calls.filter(c=>c.url.endsWith(':commit')).length,1);
  await assert.rejects(()=>h.service(call({...data,fields:{different:{stringValue:'another'}}})),e=>e.code==='already-exists');
});
test('conflicts and racing modifications never overwrite newer data or produce audit receipts',async()=>{
  const h=harness();h.put('users/a',undefined,later);await assert.rejects(()=>h.service(call(mutation('update','users/a'))),e=>e.details.reason==='conflict');assert.equal(h.docs.size,1);
  h.put('users/a');h.setBeforeCommit(()=>h.put('users/a',{newer:{stringValue:'concurrent'}},later));await assert.rejects(()=>h.service(call(mutation('update','users/a'))),e=>e.code==='failed-precondition');assert.equal(h.docs.get('users/a').fields.newer.stringValue,'concurrent');assert.equal(h.docs.size,1);
});
test('create rejects duplicates, audit edits, and unconfirmed paths',async()=>{
  const h=harness();const data=mutation('create','users/new');await h.service(call(data));assert.equal(h.docs.get('users/new').fields.title.stringValue,'새 값');
  await assert.rejects(()=>h.service(call(mutation('create','users/new'))),e=>e.code==='already-exists');
  await assert.rejects(()=>h.service(call(mutation('create',AUDIT+'/fake'))),e=>e.code==='permission-denied');
  await assert.rejects(()=>h.service(call({...mutation('delete','users/new'),confirmPath:'users/other'})),e=>e.code==='invalid-argument');
});
test('delete protects child collections and records a successful leaf deletion',async()=>{
  const h=harness();h.put('users/a');h.children.set('users/a',['prescription_records']);await assert.rejects(()=>h.service(call(mutation('delete','users/a'))),e=>e.details.reason==='children');assert.ok(h.docs.has('users/a'));
  h.children.set('users/a',[]);const data=mutation('delete','users/a');await h.service(call(data));assert.ok(!h.docs.has('users/a'));assert.ok(h.docs.has(AUDIT+'/'+data.requestId));assert.equal((await h.service(call(data))).replayed,true);
});
test('document IDs are URL encoded and collection listing includes missing ancestor documents',async()=>{
  const h=harness();await h.service(call({action:'get',path:'users/한글?#'}));assert.ok(h.calls[0].url.endsWith('/users/%ED%95%9C%EA%B8%80%3F%23'));
  let request;const service=createAdminService({authorize:async()=>({uid:'a'}),request:async(...args)=>{request=args;return {documents:[{name:ROOT+'/users/ghost'}],nextPageToken:'abc'};}});
  const data=await service(call({action:'documents',path:'users'}));assert.equal(data.documents[0].exists,false);assert.ok(request[1].includes('showMissing=true'));assert.equal(data.nextPageToken,'abc');
});
test('filtered pagination keeps collection/filter context and supports null unary filters',async()=>{
  const h=harness();h.setQueryRows(Array.from({length:26},(_,i)=>({document:{name:ROOT+'/users/u'+i,fields:{age:{integerValue:String(i)}},updateTime:stamp}})));
  const data={action:'documents',path:'users',filter:{field:'age',op:'GREATER_THAN',value:{integerValue:'0'}}};
  const first=await h.service(call(data));assert.equal(first.documents.length,25);assert.ok(first.nextPageToken);
  await h.service(call({...data,pageToken:first.nextPageToken}));const query=h.calls.at(-1).body.structuredQuery;assert.equal(query.startAt.before,false);assert.equal(query.startAt.values[0].integerValue,'24');
  await assert.rejects(()=>h.service(call({...data,filter:{...data.filter,field:'other'},pageToken:first.nextPageToken})),e=>e.code==='invalid-argument');
  await h.service(call({...data,filter:{field:'missing',op:'EQUAL',value:{nullValue:null}}}));assert.equal(h.calls.at(-1).body.structuredQuery.where.unaryFilter.op,'IS_NULL');
});
