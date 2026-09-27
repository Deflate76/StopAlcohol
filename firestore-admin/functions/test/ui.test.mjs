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
  const dialog=document.getElementById('confirmDialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
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
