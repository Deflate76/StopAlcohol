import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

for(const scenario of ['success','wrong-project','missing-account'])test('admin deployment binding: '+scenario,t=>{
  const dir=mkdtempSync(join(tmpdir(),'admin-deploy-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const log=join(dir,'calls.jsonl');
  const shim=[
    '#!/usr/bin/env node',
    "const fs=require('node:fs'),a=process.argv.slice(2);",
    "fs.appendFileSync(process.env.ADMIN_TEST_LOG,JSON.stringify(a)+'\\n');",
    "if(a[0]==='projects'&&a[1]==='describe')console.log(process.env.ADMIN_TEST_SCENARIO==='wrong-project'?'999':'1001199235857');",
    "if(a[2]==='describe'&&process.env.ADMIN_TEST_SCENARIO==='missing-account')process.exit(1);"
  ].join('\n');
  writeFileSync(join(dir,'gcloud'),shim,{mode:0o755});
  const result=spawnSync('bash',[fileURLToPath(new URL('../../enable-auto-deploy.sh',import.meta.url))],{
    env:{...process.env,PATH:dir+delimiter+process.env.PATH,ADMIN_TEST_LOG:log,ADMIN_TEST_SCENARIO:scenario},encoding:'utf8',timeout:5000
  });
  const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const writes=calls.filter(a=>a.includes('add-iam-policy-binding'));
  if(scenario==='success'){
    assert.equal(result.status,0,result.stderr);assert.equal(writes.length,1);
    assert.equal(writes[0][3],'firestore-admin-console@alcoholaway.iam.gserviceaccount.com');
    assert.ok(writes[0].includes('--member=serviceAccount:firebase-github-deploy@alcoholaway.iam.gserviceaccount.com'));
    assert.ok(writes[0].includes('--role=roles/iam.serviceAccountUser'));
  }else{assert.notEqual(result.status,0);assert.equal(writes.length,0);}
});
