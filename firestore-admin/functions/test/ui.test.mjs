import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {mountAdmin} from '../../ui.mjs';

const html=await readFile(new URL('../../../admin.html',import.meta.url),'utf8');
const stamp='2026-09-27T04:00:00.123456789Z';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function settled(){for(let i=0;i<6;i++)await tick();}
function setup(handler){
  const {document,window}=parseHTML(html);Object.defineProperty(window,'crypto',{value:webcrypto,configurable:true});
  const selectPrototype=Object.getPrototypeOf(document.createElement('select'));
  Object.defineProperty(selectPrototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value||'';},set(value){for(const option of this.options)option.removeAttribute('selected');[...this.options].find(o=>o.value===value)?.setAttribute('selected','');}});
  for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};}
  const calls=[],defaultHandler=async data=>{
    if(data.action==='session')return {uid:'admin1',admin:true};
    if(data.action==='collections')return {collections:data.path?[]:['users'],nextPageToken:''};
    if(data.action==='documents')return {documents:[{id:'a',path:'users/a',exists:true,preview:[]}],nextPageToken:''};
    if(data.action==='get')return {document:{path:data.path,exists:true,updateTime:stamp,fields:{big:{integerValue:'9223372036854775807'},time:{timestampValue:stamp},title:{stringValue:'<img src=x onerror=alert(1)>'}}}};
    if(['create','update','delete'].includes(data.action))return {ok:true,committedAt:stamp};
    throw new Error('Unexpected '+data.action);
  };
  const ui=mountAdmin(document,{call:async data=>{calls.push(data);return handler?handler(data,defaultHandler):defaultHandler(data);},login:async()=>{},logout:async()=>{},refresh:async()=>{}});
  const $=id=>document.getElementById(id),event=(node,type)=>node.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));
  const click=async id=>{event($(id),'click');await settled();};
  const open=async path=>{$('pathInput').value=path;event($('pathForm'),'submit');await settled();};
  return {ui,document,window,$,event,click,open,calls};
}
test('page starts closed and a denied account never fetches collection data',async()=>{
  const h=setup(async()=>{throw Object.assign(new Error('관리자 아님'),{code:'functions/permission-denied'});});assert.equal(h.$('workspace').hidden,true);
  await h.ui.setUser({uid:'admin1',email:'a@example.test'});assert.deepEqual(h.calls.map(x=>x.action),['session']);assert.equal(h.$('workspace').hidden,true);assert.equal(h.$('fieldList').children.length,0);assert.equal(h.ui.state.busy,false);
});
test('field editor preserves untouched types, previews changes, and saves only after confirmation',async()=>{
  const h=setup();await h.ui.setUser({uid:'admin1'});await h.open('users/a');
  assert.equal(h.$('workspace').hidden,false);assert.equal(h.document.querySelectorAll('img').length,0);
  const rows=[...h.$('fieldList').children],title=rows.find(r=>r.querySelector('.field-name').value==='title').querySelector('.field-value');
  title.value='수정';h.event(title,'input');await h.click('previewSave');assert.equal(h.$('confirmDialog').open,true);assert.equal(h.calls.filter(c=>c.action==='update').length,0);
  h.event(h.$('confirmForm'),'submit');await settled();const saved=h.calls.find(c=>c.action==='update');assert.equal(saved.fields.big.integerValue,'9223372036854775807');assert.equal(saved.fields.time.timestampValue,stamp);assert.equal(saved.fields.title.stringValue,'수정');assert.equal(saved.updateTime,stamp);assert.equal(saved.confirmPath,'users/a');
});
test('raw JSON validation blocks malformed saves without issuing a write',async()=>{
  const h=setup();await h.ui.setUser({uid:'admin1'});await h.open('users/a');h.$('rawMode').checked=true;h.event(h.$('rawMode'),'change');h.$('rawFields').value='{broken';h.event(h.$('rawFields'),'input');await h.click('previewSave');assert.equal(h.$('errorBox').hidden,false);assert.equal(h.calls.filter(c=>c.action==='update').length,0);
});
test('delete requires exact path text and retry reuses the same request ID',async()=>{
  let failures=0;const h=setup(async(data,fallback)=>{if(data.action==='delete'&&failures++===0)throw Object.assign(new Error('retry'),{code:'functions/unavailable'});return fallback(data);});
  await h.ui.setUser({uid:'admin1'});await h.open('users/a');await h.click('deleteDocument');assert.equal(h.$('acceptConfirm').disabled,true);
  h.$('deleteConfirmInput').value='users/wrong';h.event(h.$('deleteConfirmInput'),'input');assert.equal(h.$('acceptConfirm').disabled,true);
  h.$('deleteConfirmInput').value='users/a';h.event(h.$('deleteConfirmInput'),'input');h.event(h.$('confirmForm'),'submit');await settled();
  await h.click('deleteDocument');h.$('deleteConfirmInput').value='users/a';h.event(h.$('deleteConfirmInput'),'input');h.event(h.$('confirmForm'),'submit');await settled();
  const requests=h.calls.filter(c=>c.action==='delete');assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);
});
test('late responses after sign-out cannot restore private data',async()=>{
  let finish;const h=setup(async(data,fallback)=>data.action==='get'?new Promise(resolve=>{finish=resolve;}):fallback(data));
  await h.ui.setUser({uid:'admin1'});await h.open('users');h.$('pathInput').value='users/a';h.event(h.$('pathForm'),'submit');await settled();assert.ok(finish);
  await h.ui.setUser(null);finish({document:{path:'users/a',exists:true,fields:{secret:{stringValue:'private'}},updateTime:stamp}});await settled();
  assert.equal(h.$('workspace').hidden,true);assert.equal(h.$('fieldList').children.length,0);assert.equal(h.$('rawFields').value,'');assert.equal(h.ui.state.document,null);
});
test('unsaved changes can cancel navigation and audit records remain read-only',async()=>{
  const h=setup();await h.ui.setUser({uid:'admin1'});await h.open('users/a');const input=h.$('fieldList').querySelector('.field-value');input.value='5';h.event(input,'input');await h.open('posts');assert.equal(h.$('confirmDialog').open,true);await h.click('cancelConfirm');assert.equal(h.ui.state.document.path,'users/a');
  await h.ui.setUser({uid:'admin1'});await h.open('_firestore_admin_audit/receipt');assert.equal(h.$('writeActions').hidden,true);assert.equal(h.$('addField').hidden,true);assert.equal(h.$('fieldList').querySelector('.field-value').readOnly,true);
});

const productPath='drug_catalogs/otc_review_20260926_33a241232f55/products/195700020';
const productFields=()=>({
  title:{stringValue:'표 편집 테스트'},
  ingredients:{arrayValue:{values:[
    {mapValue:{fields:{name:{stringValue:'성분 A'},amount:{integerValue:'9223372036854775807'},notes:{arrayValue:{values:[{stringValue:'기존 주의'}]}}}}},
    {mapValue:{fields:{name:{stringValue:'성분 B'},amount:{integerValue:'2'},extra:{booleanValue:false}}}}
  ]}},
  metadata:{mapValue:{fields:{timestamp:{timestampValue:stamp},ref:{referenceValue:'projects/alcoholaway/databases/(default)/documents/users/a'},bytes:{bytesValue:'AQID'},point:{geoPointValue:{latitude:37.5,longitude:127}}}}}
});
function productSetup(fields=productFields()){
  return setup(async(data,fallback)=>data.action==='get'?{document:{path:data.path,exists:true,updateTime:stamp,fields:structuredClone(fields)}}:fallback(data));
}
function fieldRow(h,name){return [...h.$('fieldList').children].find(row=>row.querySelector('.field-name').value===name);}
async function openGrid(h,name){
  h.event(fieldRow(h,name).querySelector('.field-grid-button'),'click');await settled();assert.equal(h.$('gridDialog').open,true);
}
const gridJSON=(h,name)=>JSON.parse(fieldRow(h,name).querySelector('.field-value').value);

test('object-array matrix edits synchronize JSON, preserve types, and wait for final save confirmation',async()=>{
  const h=productSetup();await h.ui.setUser({uid:'admin1'});await h.open(productPath);await openGrid(h,'ingredients');
  assert.equal(h.$('gridContent').querySelectorAll('tbody tr').length,2);
  const input=h.$('gridContent').querySelector('[data-field="name"] .grid-value');input.value='<img src=x onerror=alert(1)>';h.event(input,'input');
  assert.equal(gridJSON(h,'ingredients')[0].mapValue.fields.name.stringValue,input.value);assert.equal(h.document.querySelectorAll('img').length,0);
  await h.click('gridClose');await h.click('previewSave');
  assert.match(h.$('changeList').textContent,/ingredients\[0\]/);assert.match(h.$('changeList').textContent,/이전/);
  assert.equal(h.calls.some(call=>call.action==='update'),false);
  await h.click('cancelConfirm');assert.equal(h.calls.some(call=>call.action==='update'),false);
  await h.click('previewSave');h.event(h.$('confirmForm'),'submit');await settled();
  const saved=h.calls.find(call=>call.action==='update');
  assert.equal(saved.fields.ingredients.arrayValue.values[0].mapValue.fields.amount.integerValue,'9223372036854775807');
  assert.deepEqual(saved.fields.metadata,productFields().metadata);
  assert.equal(saved.fields.ingredients.arrayValue.values[1].mapValue.fields.extra.booleanValue,false);
});

test('matrix add/delete, nested editing, and raw JSON round-trip preserve every other field',async()=>{
  const h=productSetup();await h.ui.setUser({uid:'admin1'});await h.open(productPath);await openGrid(h,'ingredients');
  h.event(h.$('gridContent').querySelector('[data-field="notes"] .grid-open'),'click');
  const note=h.$('gridContent').querySelector('.grid-value');note.value='수정 주의';h.event(note,'input');
  h.event(h.$('gridTools').querySelector('.grid-add-row'),'click');
  assert.equal(gridJSON(h,'ingredients')[0].mapValue.fields.notes.arrayValue.values.length,2);
  h.event(h.$('gridBreadcrumbs').querySelector('button'),'click');
  h.event(h.$('gridTools').querySelector('.grid-add-row'),'click');
  assert.equal(gridJSON(h,'ingredients').length,3);
  h.event(h.$('gridContent').querySelector('[aria-label="행 2 삭제"]'),'click');assert.equal(gridJSON(h,'ingredients').length,2);
  await h.click('gridClose');h.$('rawMode').checked=true;h.event(h.$('rawMode'),'change');
  const raw=JSON.parse(h.$('rawFields').value);assert.equal(raw.ingredients.arrayValue.values[0].mapValue.fields.notes.arrayValue.values[0].stringValue,'수정 주의');
  raw.ingredients.arrayValue.values[0].mapValue.fields.name.stringValue='JSON에서 변경';h.$('rawFields').value=JSON.stringify(raw);
  h.$('rawMode').checked=false;h.event(h.$('rawMode'),'change');await openGrid(h,'ingredients');
  assert.equal(h.$('gridContent').querySelector('[data-field="name"] .grid-value').value,'JSON에서 변경');
});

test('grid invalid edits block closing, cancellation restores snapshot, and malformed JSON cannot open a grid',async()=>{
  const h=productSetup();await h.ui.setUser({uid:'admin1'});await h.open(productPath);await openGrid(h,'ingredients');
  const input=h.$('gridContent').querySelector('[data-field="amount"] .grid-value');input.value='9223372036854775808';h.event(input,'input');
  await h.click('gridClose');assert.equal(h.$('gridDialog').open,true);assert.equal(h.$('gridError').hidden,false);
  await h.click('gridCancel');assert.equal(h.$('gridDialog').open,false);assert.deepEqual(gridJSON(h,'ingredients'),productFields().ingredients.arrayValue.values);
  fieldRow(h,'ingredients').querySelector('.field-value').value='[broken';
  h.event(fieldRow(h,'ingredients').querySelector('.field-grid-button'),'click');
  assert.equal(h.$('gridDialog').open,false);assert.equal(h.$('errorBox').hidden,false);assert.ok(!h.calls.some(call=>call.action==='update'));
});

test('map keys including __proto__ are literal fields and pending rename is committed when finishing',async()=>{
  const h=productSetup();await h.ui.setUser({uid:'admin1'});await h.open(productPath);await openGrid(h,'metadata');
  h.$('gridTools').querySelector('.grid-new-key').value='__proto__';h.event(h.$('gridTools').querySelector('.grid-add-row'),'click');
  assert.ok(Object.hasOwn(gridJSON(h,'metadata'),'__proto__'));assert.equal({}.stringValue,undefined);
  const name=h.$('gridContent').querySelector('.grid-key');name.value='renamed';h.event(name,'input');
  await h.click('gridClose');assert.ok(Object.hasOwn(gridJSON(h,'metadata'),'renamed'));assert.ok(!Object.hasOwn(gridJSON(h,'metadata'),'timestamp'));
});

test('grid pagination edits the correct rows, and sign-out removes open grid data',async()=>{
  const fields={rows:{arrayValue:{values:Array.from({length:31},(_,i)=>({integerValue:String(i)}))}}};
  const h=productSetup(fields);await h.ui.setUser({uid:'admin1'});await h.open(productPath);await openGrid(h,'rows');
  assert.equal(h.$('gridContent').querySelectorAll('tbody tr').length,25);
  h.event(h.$('gridTools').querySelector('.grid-pagination').lastElementChild,'click');
  assert.equal(h.$('gridContent').querySelector('.grid-value').value,'25');
  h.event(h.$('gridContent').querySelector('[aria-label="행 26 삭제"]'),'click');
  assert.equal(gridJSON(h,'rows')[25].integerValue,'26');
  await h.ui.setUser(null);assert.equal(h.$('gridDialog').open,false);assert.equal(h.$('gridContent').textContent,'');assert.equal(h.$('rawFields').value,'');
});

test('read-only audit arrays can be viewed but cannot be changed from the grid',async()=>{
  const h=productSetup();await h.ui.setUser({uid:'admin1'});await h.open('_firestore_admin_audit/example');await openGrid(h,'ingredients');
  assert.equal(h.$('gridCancel').hidden,true);assert.equal(h.$('gridTools').querySelector('.grid-add-row'),null);
  assert.ok([...h.$('gridContent').querySelectorAll('textarea,select')].every(input=>input.disabled));
  const input=h.$('gridContent').querySelector('.grid-value');input.value='blocked';h.event(input,'input');
  assert.deepEqual(gridJSON(h,'ingredients'),productFields().ingredients.arrayValue.values);assert.ok(!h.calls.some(call=>call.action==='update'));
});

test('field dropdown discovers nested fields, chooses types and restricts contains to strings',async()=>{
  const h=productSetup();await h.ui.setUser({uid:'admin1'});await h.open(productPath);
  const select=h.$('filterFieldSelect'),time=[...select.options].find(option=>option.dataset.path==='metadata.timestamp');
  assert.ok(time);select.value=time.value;h.event(select,'change');assert.equal(h.$('filterType').value,'timestampValue');
  assert.equal(h.$('filterOperator').querySelector('[value="STRING_CONTAINS"]').disabled,true);
  const title=[...select.options].find(option=>option.dataset.path==='title');select.value=title.value;h.event(select,'change');
  assert.equal(h.$('filterType').value,'stringValue');h.$('filterOperator').value='STRING_CONTAINS';h.event(h.$('filterOperator'),'change');
  h.$('filterValue').value='편집';h.event(h.$('filterForm'),'submit');await settled();
  assert.deepEqual(h.calls.filter(call=>call.action==='documents').at(-1).filter,{field:'title',op:'STRING_CONTAINS',value:{stringValue:'편집'}});
});

test('empty scan pages keep Next available and additional field discovery does not discard edits',async()=>{
  const h=setup(async(data,fallback)=>{
    if(data.action==='documents'&&!data.filter)return {documents:[],nextPageToken:'schema-more',fieldPaths:[{path:'name',types:['stringValue']}]};
    if(data.action==='documents')return {documents:[],nextPageToken:data.pageToken?'':'next-scan',scan:{scanned:200,hasMore:!data.pageToken}};
    if(data.action==='fieldPaths')return {fieldPaths:[{path:'rare.field',types:['integerValue']}],nextPageToken:''};
    return fallback(data);
  });
  await h.ui.setUser({uid:'admin1'});await h.open('users/a');
  const input=fieldRow(h,'title').querySelector('.field-value');input.value='보존할 편집';h.event(input,'input');
  await h.click('moreFilterFields');assert.equal(input.value,'보존할 편집');assert.ok(h.$('filterFieldSelect').textContent.includes('rare.field'));
  h.$('filterField').value='name';h.$('filterOperator').value='STRING_CONTAINS';h.$('filterValue').value='없음';h.event(h.$('filterForm'),'submit');await settled();
  h.event(h.$('confirmForm'),'submit');await settled();
  assert.equal(h.$('nextPage').disabled,false);assert.match(h.$('documentList').textContent,/다음 검색 범위/);
  await h.click('nextPage');assert.equal(h.$('nextPage').disabled,true);assert.equal(h.calls.filter(call=>call.filter).at(-1).pageToken,'next-scan');
  await h.open('posts');assert.ok(!h.$('filterFieldSelect').textContent.includes('rare.field'));
});
