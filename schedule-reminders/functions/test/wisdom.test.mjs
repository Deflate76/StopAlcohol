import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWisdomService} from '../wisdom.mjs';
import {fakeFirestore} from './fake-firestore.mjs';
const id = number => `wisdom_entry_${String(number).padStart(8,'0')}`;
const request = (action, data={}, uid='owner') => ({auth:{uid,token:{}},data:{action,...data}});

test('wisdom requires authenticated non-anonymous accounts and never trusts a client owner', async () => {
  const db=fakeFirestore(),api=createWisdomService({db,now:()=>1});
  await assert.rejects(api({data:{action:'list'}}),{code:'unauthenticated'});
  await assert.rejects(api({auth:{uid:'anon',token:{firebase:{sign_in_provider:'anonymous'}}},data:{action:'list'}}),{code:'permission-denied'});
  await api(request('save',{id:id(1),text:'오늘의 한 걸음을 응원해요.',uid:'other'}));
  assert(db.data.has(`daily_wisdom_accounts/owner/entries/${id(1)}`));
  assert.deepEqual((await api(request('list',{},'other'))).items,[]);
  await assert.rejects(api(request('rate',{id:id(1),rating:5},'other')),{code:'not-found'});
});

test('creation retries are idempotent and cannot overwrite text or a stored rating', async () => {
  const db=fakeFirestore(),api=createWisdomService({db,now:()=>123});
  const data={id:id(1),text:'쉬어 가는 것도 나를 돌보는 방법이에요.'};
  const results=await Promise.all([api(request('save',data)),api(request('save',data))]);
  assert.deepEqual(results[0],results[1]);assert.equal(db.data.size,1);
  await api(request('rate',{id:id(1),rating:4}));
  const retry=await api(request('save',data));assert.equal(retry.item.rating,4);
  await assert.rejects(api(request('save',{...data,text:'다른 문장'})),{code:'already-exists'});
  assert.equal(db.data.get(`daily_wisdom_accounts/owner/entries/${id(1)}`).createdAt,123);
});

test('rating validates 1–5 integers and only mutates the owned existing entry', async () => {
  const db=fakeFirestore(),api=createWisdomService({db,now:()=>1000});
  await api(request('save',{id:id(1),text:'작은 선택이 쌓여 내일을 만듭니다.'}));
  for(const rating of [0,6,1.5,'5',null])await assert.rejects(api(request('rate',{id:id(1),rating})),{code:'invalid-argument'});
  for(const rating of [1,5,2])assert.equal((await api(request('rate',{id:id(1),rating}))).item.rating,rating);
  await assert.rejects(api(request('save',{id:'../../other',text:'x'})),{code:'invalid-argument'});
  await assert.rejects(api(request('save',{id:id(2),text:'x'.repeat(161)})),{code:'invalid-argument'});
  await assert.rejects(api(request('save',{id:id(2),text:'a\nb'})),{code:'invalid-argument'});
});

test('history pagination includes every record, even equal timestamps, without duplicates', async () => {
  const db=fakeFirestore(),api=createWisdomService({db,now:()=>1000});
  for(let i=1;i<=45;i++)await api(request('save',{id:id(i),text:`격언 ${i}`}));
  const seen=[];let cursor=null;
  do {const page=await api(request('list',{cursor}));seen.push(...page.items.map(x=>x.id));cursor=page.cursor;}while(cursor);
  assert.equal(seen.length,45);assert.equal(new Set(seen).size,45);
  await assert.rejects(api(request('list',{cursor:id(999)})),{code:'aborted'});
});
