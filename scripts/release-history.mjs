import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const REPOSITORY = 'Deflate76/StopAlcohol';
export const SOURCE_BRANCH = 'Rollback-version2';
export const HISTORY_BRANCH = 'deployment-history';
export const PAGES_WORKFLOW = 259376052;
const SHA = /^[0-9a-f]{40}$/;
const sortReleases = (a,b) => b.number-a.number || b.attempt-a.attempt;
export function summarizeRun(run) {
    if (run.workflow_id !== PAGES_WORKFLOW || run.head_branch !== SOURCE_BRANCH || run.conclusion !== 'success'
        || run.status !== 'completed' || !SHA.test(run.head_sha) || !Number.isSafeInteger(run.run_number)
        || !Number.isSafeInteger(run.id)) return null;
    const attempt = run.run_attempt || 1;
    return {id:`${run.id}-${attempt}`, version:`v${run.run_number}${attempt > 1 ? '.'+attempt : ''}`,
        number:run.run_number, attempt, runId:run.id, commit:run.head_sha,
        deployedAt:run.updated_at, title:run.head_commit?.message?.split('\n')[0] || '사이트 업데이트',
        message:run.head_commit?.message || '', runUrl:`https://github.com/${REPOSITORY}/actions/runs/${run.id}`};
}
export function mergeReleases(previous, incoming) {
    const records = new Map(previous.map(row => [row.id,row]));
    for (const row of incoming) if (row) records.set(row.id,{...row,...records.get(row.id)});
    return [...records.values()].sort(sortReleases);
}
export function inferChanges(files) {
    const categories = [
        [/^(index\.html|record-|floating-actions)/, '금주 기록 화면과 사용 흐름'],
        [/^(progress-chart|calendar-|korean-calendar)/, '통계 그래프와 달력'],
        [/^control\.html/, '음주 조절 화면'],
        [/^(phr\.html|pill|otc|Drug|drug|ingredient)/i, '약수첩·의약품 정보'],
        [/^(daily-|firebase-messaging|schedule-reminders)/, '일정·알림·일일 기록'],
        [/^(account-deletion)/, '회원 계정 관리'],
        [/^firestore-admin/, '관리자 도구'],
        [/^(\.github\/|scripts\/|security-tests\/)/, '배포 자동화와 검증'],
    ];
    return categories.filter(([pattern]) => files.some(file => pattern.test(file.path))).map(([,label]) => `${label} 관련 파일을 변경했습니다.`);
}
export async function buildDetail(release, previous, api, legacyNotes = {}) {
    const sameSource = previous?.commit === release.commit;
    let comparison = previous && !sameSource
        ? await api(`/compare/${previous.commit}...${release.commit}?per_page=100&page=1`,{allow404:true})
        : sameSource ? {commits:[],files:[],total_commits:0,status:'identical'}
        : await api(`/commits/${release.commit}?per_page=100&page=1`,{allow404:true});
    const sourceChange = !!previous && !sameSource && (!comparison || ['behind','diverged'].includes(comparison.status));
    if(sourceChange)comparison=await api(`/commits/${release.commit}?per_page=100&page=1`,{allow404:true});
    const detailUnavailable=!comparison;
    comparison ||= {files:[],commits:[]};
    const compared=!!previous && !sourceChange;
    let commits = detailUnavailable ? [] : (compared ? comparison.commits : [comparison]) || [];
    const commitCount = compared ? comparison.total_commits ?? commits.length : commits.length;
    for (let page=2; compared && commits.length < commitCount; page++) {
        const result = await api(`/compare/${previous.commit}...${release.commit}?per_page=100&page=${page}`);
        if (!result.commits?.length) throw new Error('Incomplete comparison commits');
        commits.push(...result.commits);
    }
    const files = (comparison.files || []).map(file => ({path:file.filename,status:file.status,
        additions:file.additions || 0,deletions:file.deletions || 0,
        ...(file.previous_filename ? {previousPath:file.previous_filename} : {})}));
    const notes = legacyNotes[release.commit] ? [legacyNotes[release.commit]] : [];
    for (const file of comparison.files || []) {
        if (file.status !== 'added' || !/^release-notes\/[a-z0-9-]+\.json$/.test(file.filename) || file.filename.endsWith('/legacy.json') || !SHA.test(file.sha)) continue;
        const blob = await api(`/git/blobs/${file.sha}`);
        const candidate = JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'));
        if (typeof candidate.title === 'string' && Array.isArray(candidate.changes) && candidate.changes.every(x => typeof x === 'string')) notes.push(candidate);
    }
    const changes = sameSource ? ['동일한 소스를 다시 배포했습니다.'] : notes.length ? [...new Set(notes.flatMap(note=>note.changes))] : inferChanges(files);
    return {...release, title:notes.at(-1)?.title || release.title, changes,
        message:release.message,
        comparisonUrl: previous && !sameSource && !sourceChange ? `https://github.com/${REPOSITORY}/compare/${previous.commit}...${release.commit}` : `https://github.com/${REPOSITORY}/commit/${release.commit}`,
        comparisonKind:sameSource ? 'redeploy' : sourceChange ? 'source-change' : 'forward',detailUnavailable,
        // The first recoverable deployment has no known preceding deployed revision.
        baselineUnknown:!previous, filesTruncated:compared ? files.length >= 300 : files.length >= 100,
        commits:commits.map(c => ({sha:c.sha,message:c.commit?.message || '',date:c.commit?.committer?.date || c.commit?.author?.date || ''})), files};
}

export function createAPI(token, fetcher = fetch, wait = ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
    return async function api(path, {method='GET',body,allow404=false}={}) {
        if (!path.startsWith('/') || path.split(/[/?]/).includes('..')) throw new Error('Invalid API path');
        for(let attempt=0;;attempt++) {
            let response;
            try {
                response = await fetcher(`https://api.github.com/repos/${REPOSITORY}${path}`, {
                    method, headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
                    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(45000)
                });
            } catch(error) {
                if(method!=='GET' || attempt>=2)throw error;
                await wait(1000 * 2**attempt);continue;
            }
            if (allow404 && response.status === 404) return null;
            if (method==='GET' && response.status>=500 && attempt<2) {await wait(1000 * 2**attempt);continue;}
            if (!response.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} returned ${response.status}`);
            return response.json();
        }
    };
}
export async function collectSuccessfulRuns(api) {
    const rows=[];
    // Workflow-specific pagination avoids mixing security/backend checks with site releases.
    for(let page=1;;page++) {
        const result=await api(`/actions/workflows/${PAGES_WORKFLOW}/runs?branch=${SOURCE_BRANCH}&per_page=100&page=${page}`);
        const runs=result.workflow_runs;
        if(!Array.isArray(runs)) throw new Error('Missing workflow runs');
        rows.push(...runs.map(summarizeRun).filter(Boolean));
        for(const run of runs)for(let attempt=1;attempt<(run.run_attempt||1);attempt++) {
            const earlier=await api(`/actions/runs/${run.id}/attempts/${attempt}`,{allow404:true});
            if(earlier)rows.push(summarizeRun({...run,...earlier}));
        }
        if(runs.length<100) break;
    }
    return mergeReleases([],rows);
}
export async function publishHistory(api, {legacyNotes={}, now=()=>new Date().toISOString()}={}) {
    const ref=await api(`/git/ref/heads/${HISTORY_BRANCH}`,{allow404:true});
    let index={schemaVersion:1,releases:[]}, baseTree;
    if(ref) {
        const [file,commit]=await Promise.all([
            api(`/contents/index.json?ref=${ref.object.sha}`),api(`/git/commits/${ref.object.sha}`)
        ]);
        index=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
        if(index.schemaVersion!==1 || !Array.isArray(index.releases)) throw new Error('Unknown archive format');
        baseTree=commit.tree.sha;
    }
    const discovered=await collectSuccessfulRuns(api);
    const releases=mergeReleases(index.releases,discovered);
    const existing=new Set(index.releases.filter(row=>row.detailPath).map(row=>row.id));
    const pending=releases.filter(row=>!existing.has(row.id));
    if(!pending.length) return {added:0,total:releases.length};
    const files=[];
    // Newest first; all writes are atomic, so an incomplete run never replaces the archive.
    for(const release of pending) {
        const previous=releases[releases.indexOf(release)+1];
        const detail=await buildDetail(release,previous,api,legacyNotes);
        Object.assign(release,{title:detail.title,changes:detail.changes,detailPath:`versions/${release.id}.json`});
        files.push({path:release.detailPath,mode:'100644',type:'blob',content:JSON.stringify(detail)});
    }
    const archive={schemaVersion:1,repository:REPOSITORY,sourceBranch:SOURCE_BRANCH,generatedAt:now(),
        releases:releases.map(({message,...summary})=>summary)};
    files.push({path:'index.json',mode:'100644',type:'blob',content:JSON.stringify(archive)});
    const tree=await api('/git/trees',{method:'POST',body:{...(baseTree?{base_tree:baseTree}:{}),tree:files}});
    const commit=await api('/git/commits',{method:'POST',body:{message:`Archive ${pending.length} successful Alcoholaway deployments`,tree:tree.sha,parents:ref?[ref.object.sha]:[]}});
    if(ref) await api(`/git/refs/heads/${HISTORY_BRANCH}`,{method:'PATCH',body:{sha:commit.sha,force:false}});
    else await api('/git/refs',{method:'POST',body:{ref:`refs/heads/${HISTORY_BRANCH}`,sha:commit.sha}});
    return {added:pending.length,total:releases.length};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
    if(process.env.GITHUB_REPOSITORY!==REPOSITORY || !process.env.GH_TOKEN) throw new Error('Repository-scoped Actions token is required');
    const notes=JSON.parse(await readFile(new URL('../release-notes/legacy.json',import.meta.url),'utf8'));
    const result=await publishHistory(createAPI(process.env.GH_TOKEN),{legacyNotes:notes});
    console.log(`Archived ${result.added} new deployments; ${result.total} total.`);
}
