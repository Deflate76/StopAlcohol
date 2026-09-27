import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script=fileURLToPath(new URL('../../prepare-iam.sh',import.meta.url));
const shim=`#!/usr/bin/env node
const fs=require('node:fs');
const a=process.argv.slice(2), mode=process.env.ADMIN_IAM_TEST_CASE;
const file=process.env.ADMIN_IAM_TEST_STATE;
const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{bind:0,create:0};
fs.appendFileSync(process.env.ADMIN_IAM_TEST_LOG,JSON.stringify(a)+'\\n');
const fail=message=>{console.error(message);process.exit(1);};
if(a[0]==='projects'&&a[1]==='describe'){console.log('alcoholaway');process.exit(0);}
if(a[0]==='iam'&&a[2]==='describe'){
 if(mode==='describe-denied')fail('PERMISSION_DENIED: cannot read accounts');
 if(['fresh','create-race'].includes(mode))fail('NOT_FOUND: account not visible');
 process.exit(0);
}
if(a[0]==='iam'&&a[2]==='create'){
 s.create++;fs.writeFileSync(file,JSON.stringify(s));
 if(mode==='create-race')fail('ALREADY_EXISTS: account exists');
 process.exit(0);
}
if(a[0]==='projects'&&a[1]==='add-iam-policy-binding'){
 s.bind++;fs.writeFileSync(file,JSON.stringify(s));
 if(mode==='denied')fail('PERMISSION_DENIED: cannot change policy');
 if(mode==='condition')fail('INVALID_ARGUMENT: invalid condition expression');
 if(mode==='permanent'||(mode==='fresh'&&s.bind<4))fail('INVALID_ARGUMENT: Service account firestore-admin-console@alcoholaway.iam.gserviceaccount.com does not exist.');
 if(mode==='second-role'&&s.bind===2)fail('PERMISSION_DENIED: second role denied');
 process.exit(0);
}
fail('Unexpected gcloud command');
`;
function run(mode){
 const dir=mkdtempSync(join(tmpdir(),'alcoholaway-iam-test-'));
 try{
  const log=join(dir,'calls.jsonl'),state=join(dir,'state.json');
  writeFileSync(join(dir,'gcloud'),shim,{mode:0o755});
  writeFileSync(join(dir,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const result=spawnSync('bash',[script],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:dir+':'+process.env.PATH,ADMIN_IAM_TEST_CASE:mode,ADMIN_IAM_TEST_LOG:log,ADMIN_IAM_TEST_STATE:state}});
  return {...result,calls:existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[]};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const grants=r=>r.calls.filter(a=>a[1]==='add-iam-policy-binding');
test('IAM setup retries propagation delay and grants exactly the two intended roles',()=>{
 const r=run('fresh');assert.equal(r.status,0,r.stderr);assert.equal(grants(r).length,5);
 assert.deepEqual([...new Set(grants(r).map(a=>a.find(x=>x.startsWith('--role='))))],['--role=roles/datastore.user','--role=roles/firebaseauth.viewer']);
 assert.equal(r.calls.filter(a=>a[2]==='create').length,1);assert.match(r.stdout,/IAM 반영 대기/);
});
test('IAM setup reuses an existing account and tolerates a just-created account visibility race',()=>{
 const existing=run('existing');assert.equal(existing.status,0);assert.equal(existing.calls.filter(a=>a[2]==='create').length,0);
 const race=run('create-race');assert.equal(race.status,0);assert.equal(grants(race).length,2);
});
test('IAM setup stops on permission or condition failures instead of retrying or creating an account',()=>{
 for(const mode of ['describe-denied','denied','condition','second-role']){
  const r=run(mode);assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/IAM 반영 대기/);assert.doesNotMatch(r.stdout,/전용 실행 계정을 준비했습니다/);
  assert.equal(r.calls.filter(a=>a[2]==='create').length,0);
  assert.equal(grants(r).length,mode==='describe-denied'?0:mode==='second-role'?2:1);
 }
});
test('IAM setup has a finite retry limit and never reports success after it is exhausted',()=>{
 const r=run('permanent');assert.notEqual(r.status,0);assert.equal(grants(r).length,9);assert.match(r.stderr,/재시도 한도/);assert.doesNotMatch(r.stdout,/전용 실행 계정을 준비했습니다/);
});
