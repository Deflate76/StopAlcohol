const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(path.resolve(__dirname,'../scripts/release-history.mjs')));
const sha='a'.repeat(40),oldSha='b'.repeat(40),blobSha='c'.repeat(40);
const run=(number,extra={})=>({id:number,workflow_id:259376052,head_branch:'Rollback-version2',head_sha:sha,run_number:number,run_attempt:1,status:'completed',conclusion:'success',updated_at:'2026-10-05T08:00:00Z',head_commit:{message:'Update app'},...extra});
const encoded=value=>({content:Buffer.from(JSON.stringify(value)).toString('base64')});

test('only successful Pages deployments become versions, and archived descriptions survive future runs',async()=>{
    const {summarizeRun,mergeReleases}=await modulePromise;
    assert.equal(summarizeRun(run(9,{conclusion:'failure'})),null);
    assert.equal(summarizeRun(run(9,{workflow_id:1})),null);
    assert.equal(summarizeRun(run(9,{head_branch:'other'})),null);
    const row=summarizeRun(run(9,{run_attempt:2}));assert.equal(row.version,'v9.2');
    const merged=mergeReleases([{...row,title:'한국어 설명',detailPath:'versions/9-2.json'}],[row,summarizeRun(run(10))]);
    assert.deepEqual(merged.map(r=>r.version),['v10','v9.2']);assert.equal(merged[1].title,'한국어 설명');
    const rerun=summarizeRun(run(9,{run_attempt:3,updated_at:'2026-10-06T08:00:00Z'}));
    assert.equal(mergeReleases(merged,[rerun])[0].version,'v9.3','an older run redeployed today is the latest actual deployment');
});

test('backfill paginates Pages runs and recovers successful attempts before a failed rerun',async()=>{
    const {collectSuccessfulRuns}=await modulePromise;const requested=[];
    const records=await collectSuccessfulRuns(async url=>{
        requested.push(url);
        if(url.includes('/attempts/1'))return run(101);
        if(url.endsWith('&page=1'))return{workflow_runs:[run(101,{conclusion:'failure',run_attempt:2}),...Array.from({length:99},(_,i)=>run(100-i))]};
        return{workflow_runs:[run(1)]};
    });
    assert.equal(records.length,101);assert.equal(records[0].version,'v101');assert(requested.some(url=>url.includes('page=2')));
});

test('detail spans commits between deployments and includes release notes from all added note files',async()=>{
    const {buildDetail,summarizeRun}=await modulePromise;
    const release=summarizeRun(run(9)),previous={commit:oldSha};const requested=[];
    const notePath='release-notes/2026-10-05-history.json';
    const detail=await buildDetail(release,previous,async url=>{
        requested.push(url);
        if(url.startsWith('/git/blobs/'))return encoded({title:'배포 이력',changes:['자동 버전','상세 이력']});
        if(url.endsWith('page=2'))return{commits:[{sha:blobSha,commit:{message:'Second update'}}]};
        return{status:'ahead',total_commits:2,commits:[{sha,commit:{message:'First update'}}],files:[{filename:notePath,status:'added',sha:blobSha,additions:4}]};
    });
    assert.equal(detail.commits.length,2);assert.equal(detail.title,'배포 이력');assert.deepEqual(detail.changes,['자동 버전','상세 이력']);
    assert(requested.some(url=>url.endsWith('page=2')));assert.equal(detail.comparisonKind,'forward');
});

test('rollback, missing historical sources, and identical-source redeployment are described truthfully',async()=>{
    const {buildDetail,summarizeRun}=await modulePromise;const release=summarizeRun(run(9)),previous={commit:oldSha};
    const rollback=await buildDetail(release,previous,async url=>url.startsWith('/compare/')?{status:'behind',commits:[],files:[]}:{sha,commit:{message:'Original restored version'},files:[{filename:'index.html',status:'modified'}]});
    assert.equal(rollback.comparisonKind,'source-change');assert.equal(rollback.commits[0].message,'Original restored version');assert(rollback.comparisonUrl.includes('/commit/'));
    const missing=await buildDetail(release,previous,async()=>null);assert(missing.detailUnavailable);assert.equal(missing.commits.length,0);
    const same=await buildDetail(release,{commit:sha},async()=>assert.fail('no API needed'));
    assert.equal(same.comparisonKind,'redeploy');assert.match(same.changes[0],/다시 배포/);
});

test('archive commits detail and index atomically, preserves the previous tree, and never rewrites an existing release',async()=>{
    const {publishHistory,summarizeRun}=await modulePromise;const current={...summarizeRun(run(8,{head_sha:oldSha})),title:'기존 설명',changes:['기존 개선'],detailPath:'versions/8-1.json'};
    const calls=[];let tree;
    const api=async(url,options={})=>{
        calls.push({url,...options});
        if(url==='/git/ref/heads/deployment-history')return{object:{sha:oldSha}};
        if(url.startsWith('/contents/'))return encoded({schemaVersion:1,releases:[current]});
        if(url===`/git/commits/${oldSha}`)return{tree:{sha:blobSha}};
        if(url.startsWith('/actions/'))return{workflow_runs:[run(9),run(8,{head_sha:oldSha})]};
        if(url.startsWith('/compare/'))return{status:'ahead',commits:[{sha,commit:{message:'Update app'}}],files:[]};
        if(url==='/git/trees'){tree=options.body;return{sha};}
        if(url==='/git/commits')return{sha};
        if(url==='/git/refs/heads/deployment-history')return{};
        assert.fail(url);
    };
    assert.deepEqual(await publishHistory(api),{added:1,total:2});assert.equal(tree.base_tree,blobSha);
    assert.deepEqual(tree.tree.map(file=>file.path),['versions/9-1.json','index.json']);
    const index=JSON.parse(tree.tree[1].content);assert.equal(index.releases[1].title,'기존 설명');
    assert.equal(calls.at(-1).method,'PATCH');assert.equal(calls.at(-1).body.force,false);
    assert.deepEqual(calls.find(c=>c.url==='/git/commits').body.parents,[oldSha]);
    const noWrites=async(url,options)=>{if(options?.method)assert.fail('unexpected write');if(url.startsWith('/actions/'))return{workflow_runs:[run(8,{head_sha:oldSha})]};return api(url,options);};
    assert.deepEqual(await publishHistory(noWrites),{added:0,total:1});
});

test('failed collection never publishes a partial archive; transient reads retry without retrying writes',async()=>{
    const {publishHistory,createAPI}=await modulePromise;let writes=0;
    await assert.rejects(publishHistory(async(url,options={})=>{
        if(options.method)writes++;
        if(url.startsWith('/git/ref/'))return null;
        if(url.startsWith('/actions/'))return{workflow_runs:[run(9),run(8,{head_sha:oldSha})]};
        throw Error('upstream failure');
    }),/upstream failure/);assert.equal(writes,0);
    let reads=0;const api=createAPI('fixture-token',async()=>++reads<3?{ok:false,status:503}:{ok:true,json:async()=>({done:true})},async()=>{});
    assert.deepEqual(await api(`/compare/${oldSha}...${sha}`),{done:true});assert.equal(reads,3);
    let posts=0;const writer=createAPI('fixture-token',async()=>{posts++;return{ok:false,status:503};},async()=>{});
    await assert.rejects(writer('/git/commits',{method:'POST',body:{}}),/503/);assert.equal(posts,1);
});

test('push-triggered archive waits for the matching Pages deployment and never treats failures as success',async()=>{
    const {waitForDeployment}=await modulePromise;let calls=0,waits=0;
    const complete=await waitForDeployment(async()=>({workflow_runs:++calls===1?[]:calls===2?[run(9,{head_sha:oldSha}),run(8,{status:'in_progress',conclusion:null})]:[run(8)]}),sha,{wait:async()=>{waits++;},attempts:3});
    assert.equal(complete,true);assert.equal(waits,2);
    assert.equal(await waitForDeployment(async()=>({workflow_runs:[run(9,{conclusion:'failure'})]}),sha,{attempts:1}),false);
    await assert.rejects(waitForDeployment(async()=>({workflow_runs:[]}),sha,{attempts:1}),/still pending/);
});
