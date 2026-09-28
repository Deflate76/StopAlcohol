import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminService} from '../service.mjs';
import {parseFieldPath,formatFieldPath,collectFieldPaths,fieldValue} from '../field-paths.mjs';
import {diffEntries} from '../value-codec.mjs';

const ROOT='projects/alcoholaway/databases/(default)/documents';
const path='drug_catalogs/otc_review_20260926_33a241232f55/products';
const stamp='2026-09-28T00:00:00.123456789Z',BT=String.fromCharCode(96);
const doc=(id,fields)=>({name:ROOT+'/'+path+'/'+String(id).padStart(9,'0'),fields,updateTime:stamp});
function searchService(documents){
  const calls=[];
  return {calls,handle:createAdminService({authorize:async()=>({uid:'admin'}),request:async(method,url,body)=>{
    calls.push({method,url,body});
    const query=body.structuredQuery,start=query.startAt?.values.at(-1).referenceValue;
    return documents.filter(document=>!start||document.name>start).slice(0,query.limit).map(document=>({document}));
  }})};
}
const request=(filter,extra={})=>({data:{action:'documents',path,filter,...extra}});
const contains={field:'name',op:'STRING_CONTAINS',value:{stringValue:'정'}};

test('substring search reaches matches beyond the first scan and exposes continuation on empty pages',async()=>{
  const docs=Array.from({length:405},(_,i)=>doc(i,{name:{stringValue:i===350?'가운데 정 포함':'다른 이름'}}));
  const h=searchService(docs),first=await h.handle(request(contains));
  assert.equal(first.documents.length,0);assert.equal(first.scan.scanned,200);assert.equal(first.scan.hasMore,true);
  assert.ok(first.nextPageToken);
  const second=await h.handle(request(contains,{pageToken:first.nextPageToken}));
  assert.equal(second.documents[0].id,'000000350');assert.equal(second.scan.scanned,200);assert.ok(second.nextPageToken);
  const third=await h.handle(request(contains,{pageToken:second.nextPageToken}));
  assert.equal(third.scan.scanned,5);assert.equal(third.nextPageToken,'');assert.equal(third.scan.hasMore,false);
  assert.equal(h.calls[0].body.structuredQuery.limit,201);
  assert.equal(h.calls[0].body.structuredQuery.where,undefined);
  assert.deepEqual(h.calls[0].body.structuredQuery.select,{fields:[{fieldPath:'name'}]});
});

test('25-result cutoff resumes after the last examined document without skipping the rest of a fetched batch',async()=>{
  const h=searchService(Array.from({length:80},(_,i)=>doc(i,{name:{stringValue:'정'}})));
  const ids=[];let pageToken='';
  do{
    const result=await h.handle(request(contains,{pageToken}));
    ids.push(...result.documents.map(doc=>doc.id));pageToken=result.nextPageToken;
  }while(pageToken);
  assert.equal(ids.length,80);assert.equal(new Set(ids).size,80);assert.equal(ids.at(-1),'000000079');
});

test('contains uses literal case-sensitive full strings and excludes non-string or absent fields',async()=>{
  const h=searchService([
    doc(0,{name:{stringValue:'x'.repeat(300)+'a.*B'}}),doc(1,{name:{stringValue:'aZZB'}}),
    doc(2,{name:{stringValue:'a.*b'}}),doc(3,{name:{integerValue:'12'}}),doc(4,{name:{nullValue:null}}),doc(5,{})
  ]);
  const result=await h.handle(request({...contains,value:{stringValue:'a.*B'}}));
  assert.deepEqual(result.documents.map(doc=>doc.id),['000000000']);
  for(const value of [{stringValue:''},{integerValue:'1'},{stringValue:'x'.repeat(1001)}])
    await assert.rejects(()=>h.handle(request({...contains,value})),error=>error.code==='invalid-argument');
});

test('contains cursors cannot be reused for another collection, field, or search value',async()=>{
  const h=searchService(Array.from({length:30},(_,i)=>doc(i,{name:{stringValue:'정'}})));
  const first=await h.handle(request(contains));
  for(const change of [{path:'users'},{filter:{...contains,field:'other'}},{filter:{...contains,value:{stringValue:'다른'}}}])
    await assert.rejects(()=>h.handle(request(contains,{pageToken:first.nextPageToken,...change})),error=>error.code==='invalid-argument');
  const cursor=JSON.parse(Buffer.from(first.nextPageToken,'base64url').toString());
  cursor.values=[{referenceValue:ROOT+'/users/private'}];
  await assert.rejects(()=>h.handle(request(contains,{pageToken:Buffer.from(JSON.stringify(cursor)).toString('base64url')})),error=>error.code==='invalid-argument');
});

test('field discovery includes nested map paths, preserves literal punctuation and stops at arrays',()=>{
  const fields=JSON.parse('{"name":{"stringValue":"샘플"},"a.b":{"mapValue":{"fields":{"한글":{"integerValue":"1"}}}},"__proto__":{"stringValue":"literal"},"ingredients":{"arrayValue":{"values":[{"mapValue":{"fields":{"private":{"stringValue":"x"}}}}]}}}');
  const found=collectFieldPaths([{fields},{fields:{name:{integerValue:'2'}}}]);
  assert.deepEqual(found.fieldPaths.find(field=>field.path==='name').types,['integerValue','stringValue']);
  const literalPath=BT+'a.b'+BT+'.'+BT+'한글'+BT;
  assert.ok(found.fieldPaths.some(field=>field.path===literalPath));
  assert.ok(found.fieldPaths.some(field=>field.path==='ingredients'));
  assert.ok(!found.fieldPaths.some(field=>field.path.includes('private')));
  assert.equal(fieldValue(fields,literalPath).integerValue,'1');
  assert.equal(fieldValue(fields,'__proto__').stringValue,'literal');
  assert.equal(fieldValue({},'__proto__'),undefined);
  const special=['a.b','x'+BT+'y','slash\\','한글'];
  assert.deepEqual(parseFieldPath(formatFieldPath(special)),special);
  for(const invalid of ['a..b','a.',BT+'not closed',BT+'x'+BT+'oops',BT+'x\\q'+BT,'__name__',BT+'__name__'+BT])assert.throws(()=>parseFieldPath(invalid));
  assert.equal(collectFieldPaths([{fields}],1).fieldsTruncated,true);
});

test('field-path pages use bounded document reads and include non-preview fields',async()=>{
  let received;
  const handle=createAdminService({authorize:async()=>({uid:'admin'}),request:async(method,url)=>{
    received={method,url};
    return {documents:[doc(1,{one:{stringValue:'a'},two:{integerValue:'1'},three:{booleanValue:true},four:{stringValue:'b'}})],nextPageToken:'next-fields'};
  }});
  const result=await handle({data:{action:'fieldPaths',path,pageToken:'fields-token'}});
  assert.equal(result.fieldPaths.length,4);assert.equal(result.nextPageToken,'next-fields');assert.deepEqual(result.documents,[]);
  assert.match(received.url,/pageSize=25/);assert.match(received.url,/pageToken=fields-token/);
  const denied=createAdminService({authorize:async()=>{throw new Error('denied');},request:async()=>assert.fail('must not read')});
  await assert.rejects(()=>denied({data:{action:'fieldPaths',path}}),/denied/);
});

test('nested change preview shows changed leaf values and reports truncation accurately',()=>{
  const before={items:{arrayValue:{values:[{mapValue:{fields:{name:{stringValue:'이전'},amount:{integerValue:'9223372036854775807'}}}}]}}};
  const after=structuredClone(before);after.items.arrayValue.values[0].mapValue.fields.name.stringValue='이후';
  const diff=diffEntries(before,after);
  assert.equal(diff.total,1);assert.equal(diff.changes[0].key,'items[0]["name"]');assert.equal(diff.changes[0].after.stringValue,'이후');
  assert.equal(diffEntries({},Object.fromEntries(Array.from({length:120},(_,i)=>['field'+i,{integerValue:String(i)}]))).changes.length,100);
  assert.equal(diffEntries({},Object.fromEntries(Array.from({length:120},(_,i)=>['field'+i,{integerValue:String(i)}]))).total,120);
});
