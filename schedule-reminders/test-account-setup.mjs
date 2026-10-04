import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const authPermissions=['firebaseauth.users.get','firebaseauth.users.update','firebaseauth.users.delete'];
const photoPermissions=['storage.objects.list','storage.objects.delete'];
const mock=`#!/usr/bin/env node
const fs=require('node:fs'),file=process.env.ACCOUNT_TEST_STATE,s=JSON.parse(fs.readFileSync(file));
const a=process.argv.slice(2),command=a.slice(0,3).join(' '),option=key=>a.find(v=>v.startsWith(key+'='))?.slice(key.length+1);
s.calls.push(a);
function finish(value='',code=0){fs.writeFileSync(file,JSON.stringify(s));if(value)(code?process.stderr:process.stdout).write(typeof value==='string'?value:JSON.stringify(value));process.exit(code)}
if(a[0]==='projects'&&a[1]==='describe')finish(s.project);
if(command==='storage buckets describe'){
 if(!a.includes('--raw')||option('--format')!=='value(projectNumber)')finish('Expected raw project number',9);
 finish(s.bucket);
}
if(command==='iam roles describe'){
 if(s.inspectDenied)finish('PERMISSION_DENIED: cannot inspect role',1);
 if(!s.roles[a[3]])finish('NOT_FOUND: role not found',1);
 finish(s.roles[a[3]]);
}
if(command==='iam roles create'){
 s.roles[a[3]]={includedPermissions:option('--permissions').split(','),stage:'GA'};finish();
}
if(a[0]==='projects'&&a[1]==='add-iam-policy-binding'){
 if(s.grantDenied)finish('PERMISSION_DENIED: missing setIamPolicy',1);
 if(s.pending>0){s.pending--;finish("Role does not exist in the resource's hierarchy",1);}
 const binding={role:option('--role'),member:option('--member'),condition:option('--condition')};
 if(!s.bindings.some(b=>JSON.stringify(b)===JSON.stringify(binding)))s.bindings.push(binding);
 finish();
}
finish('Unexpected gcloud command: '+a.join(' '),99);
`;
function fixture(t,overrides={}){
 const directory=mkdtempSync(join(tmpdir(),'account-setup-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const statePath=join(directory,'state.json');
 writeFileSync(join(directory,'gcloud'),mock,{mode:0o755});
 writeFileSync(join(directory,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 writeFileSync(statePath,JSON.stringify({project:'1001199235857',bucket:'1001199235857',pending:0,
  roles:{alcoholawayAccountDeletion:{includedPermissions:authPermissions,stage:'GA'},alcoholawayPhotoDeletion:{includedPermissions:photoPermissions,stage:'GA'}},
  calls:[],bindings:[],...overrides}));
 return{read:()=>JSON.parse(readFileSync(statePath,'utf8')),run:(...args)=>spawnSync('bash',[fileURLToPath(new URL('./setup-account-deletion.sh',import.meta.url)),...args],{
  env:{...process.env,PATH:directory+delimiter+process.env.PATH,ACCOUNT_TEST_STATE:statePath},encoding:'utf8',timeout:15000
 })};
}
test('storage-only repairs the remaining binding without changing successful Auth setup',t=>{
 const f=fixture(t),result=f.run('--storage-only');assert.equal(result.status,0,result.stderr);
 const state=f.read();assert.equal(state.bindings.length,1);
 assert.equal(state.bindings[0].role,'projects/alcoholaway/roles/alcoholawayPhotoDeletion');
 assert.equal(state.bindings[0].member,'serviceAccount:daily-schedules-runtime@alcoholaway.iam.gserviceaccount.com');
 assert.ok(state.calls.every(a=>!a.includes('alcoholawayAccountDeletion')));
 assert.ok(state.calls.every(a=>a.slice(0,3).join(' ')!=='storage buckets add-iam-policy-binding'));
 assert.ok(state.calls.every(a=>!['update','delete','set-iam-policy','objects'].some(word=>a.includes(word))));
 const expression=state.bindings[0].condition.split(',expression=')[1];
 const permits=name=>Function('resource','return ('+expression+')')({name});
 for(const name of ['projects/_/buckets/alcoholaway.firebasestorage.app',
  'projects/_/buckets/alcoholaway.firebasestorage.app/objects/health_records/alice/photo.jpg',
  'projects/_/buckets/alcoholaway.firebasestorage.app/objects/pill_identification/alice/one/front.jpg'])assert.equal(permits(name),true,name);
 for(const name of ['projects/_/buckets/other/objects/health_records/alice/photo.jpg',
  'projects/_/buckets/alcoholaway.firebasestorage.app-extra/objects/health_records/alice/photo.jpg',
  'projects/_/buckets/alcoholaway.firebasestorage.app/objects/catalog/one.jpg',
  'projects/_/buckets/alcoholaway.firebasestorage.app/objects/health_records_extra/one.jpg'])assert.equal(permits(name),false,name);
 assert.equal(f.run('--storage-only').status,0);assert.equal(f.read().bindings.length,1,'repeat is idempotent');
});
test('full setup creates only the two minimal roles and preserves other IAM bindings',t=>{
 const other={role:'roles/unrelated',member:'serviceAccount:other@example.test',condition:'None'};
 const f=fixture(t,{roles:{},bindings:[other]});const result=f.run();assert.equal(result.status,0,result.stderr);
 const s=f.read();assert.deepEqual(s.roles.alcoholawayAccountDeletion.includedPermissions,authPermissions);
 assert.deepEqual(s.roles.alcoholawayPhotoDeletion.includedPermissions,photoPermissions);
 assert.deepEqual(s.bindings[0],other);assert.equal(s.bindings.length,3);
 assert.equal(f.run().status,0);assert.equal(f.read().bindings.length,3);
});
for(const [name,overrides]of [['wrong project',{project:'999999'}],['wrong bucket project',{bucket:'999999'}],['unknown bucket owner',{bucket:''}]]){
 test(name+' stops before any IAM change',t=>{
  const f=fixture(t,overrides),r=f.run('--storage-only');assert.notEqual(r.status,0);assert.equal(f.read().bindings.length,0);
  assert.ok(f.read().calls.every(a=>a.includes('describe')));assert.doesNotMatch(r.stdout,/binding saved/);
 });
}
test('temporary role propagation retries the same conditional grant',t=>{
 const f=fixture(t,{pending:2}),r=f.run('--storage-only');assert.equal(r.status,0,r.stderr);
 const grants=f.read().calls.filter(a=>a[1]==='add-iam-policy-binding');assert.equal(grants.length,3);assert.deepEqual(grants[0],grants[2]);
});
test('persistent hierarchy failure and IAM denials never report success or broaden access',t=>{
 for(const overrides of [{pending:50},{grantDenied:true},{inspectDenied:true}]){
  const f=fixture(t,overrides),r=f.run('--storage-only');assert.notEqual(r.status,0);assert.equal(f.read().bindings.length,0);
  assert.doesNotMatch(r.stdout,/binding saved/);assert.ok(f.read().calls.every(a=>!a.some(v=>/roles\/(owner|editor|storage\.admin|storage\.objectAdmin)/.test(v))));
  if(overrides.grantDenied)assert.equal(f.read().calls.filter(a=>a[1]==='add-iam-policy-binding').length,1);
 }
});
test('unexpected existing photo role permissions are not granted or silently overwritten',t=>{
 const f=fixture(t,{roles:{alcoholawayPhotoDeletion:{includedPermissions:[...photoPermissions,'storage.objects.get'],stage:'GA'}}});
 const r=f.run('--storage-only');assert.notEqual(r.status,0);assert.equal(f.read().bindings.length,0);assert.ok(f.read().calls.every(a=>!a.includes('update')));
});
