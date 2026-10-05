const ARCHIVE = 'https://raw.githubusercontent.com/Deflate76/StopAlcohol/deployment-history/';
const CACHE_KEY = 'alcoholaway:public-release-history:v1';
const SHA = /^[a-f0-9]{40}$/;
const ID = /^\d+-\d+$/;
const VERSION = /^v\d+(?:\.\d+)?$/;
const PAGE_SIZE = 12;
const text = value => typeof value === 'string' ? value : '';
export function normalizeHistory(value) {
    if (value?.schemaVersion !== 1 || !Array.isArray(value.releases)) throw new Error('Invalid release history');
    const ids = new Set();
    return value.releases.filter(row => row && ID.test(row.id) && VERSION.test(row.version) && SHA.test(row.commit)
        && Number.isSafeInteger(row.number) && Number.isSafeInteger(row.attempt) && row.number > 0 && row.attempt > 0
        && Number.isFinite(Date.parse(row.deployedAt))).filter(row => {
            if (ids.has(row.id)) return false; ids.add(row.id); return true;
        }).map(row => ({...row,title:text(row.title),message:text(row.message),changes:Array.isArray(row.changes) ? row.changes.filter(x => typeof x === 'string') : [],
            detailPath:`versions/${row.id}.json`})).sort((a,b) => Date.parse(b.deployedAt)-Date.parse(a.deployedAt) || b.number-a.number || b.attempt-a.attempt);
}
export function formatReleaseDate(value) {
    return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
}
export function installReleaseHistory({doc=document,win=window,fetcher=fetch,now=Date.now}={}) {
    const button=doc.getElementById('appVersionLabel'),dialog=doc.getElementById('releaseHistoryModal');
    if (!button || !dialog) return;
    const list=doc.getElementById('releaseHistoryList'),status=doc.getElementById('releaseHistoryStatus');
    const search=doc.getElementById('releaseHistorySearch'),more=doc.getElementById('releaseHistoryMore'),refresh=doc.getElementById('releaseHistoryRefresh');
    let releases=[],currentCommit='',shown=PAGE_SIZE,loading=null,lastFetched=0,poll=0,pollCount=0;
    const details=new Map();
    const node=(tag,value,className)=>{const el=doc.createElement(tag);if(value!==undefined)el.textContent=value;if(className)el.className=className;return el;};
    const link=(label,url)=>{const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    async function json(url) {
        const controller=new win.AbortController();
        const timer=win.setTimeout(()=>controller.abort(),12000);
        try {const response=await fetcher(url,{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok)throw new Error('Request failed');return await response.json();}
        finally{win.clearTimeout(timer);}
    }
    function cached() {try {return normalizeHistory(JSON.parse(win.localStorage.getItem(CACHE_KEY)));} catch {return [];} }
    function saveCache() {try {win.localStorage.setItem(CACHE_KEY,JSON.stringify({schemaVersion:1,releases}));} catch { /* Private browsing or storage quota. */ } }
    function setVersion() {
        const current=releases.find(row=>row.commit===currentCommit);
        button.textContent=current?.version || (currentCommit ? `빌드 ${currentCommit.slice(0,7)}` : '버전 이력');
        button.setAttribute('aria-label', `${current ? current.version + ', ' : ''}버전별 업데이트 이력 보기`);
        const label=doc.getElementById('releaseHistoryCurrent');
        label.textContent=current ? `현재 배포 ${current.version} · ${formatReleaseDate(current.deployedAt)}`
            : currentCommit ? '새 배포의 상세 이력을 준비하고 있습니다.' : '버전 번호는 성공한 GitHub 배포 순서입니다.';
    }
    function renderDetails(container, release, detail) {
        container.replaceChildren();
        if(detail.detailUnavailable)container.append(node('p','오래된 배포의 소스 파일을 확인할 수 없어 남아 있는 배포 설명을 표시합니다.','release-muted'));
        if(detail.baselineUnknown)container.append(node('p','이 배포는 앞선 배포의 소스를 확인할 수 없어 배포 커밋 기준으로 표시합니다.','release-muted'));
        if(detail.comparisonKind==='source-change')container.append(node('p','이전 배포와 소스 이력이 달라 배포 커밋의 변경 내용을 표시합니다.','release-muted'));
        const commits=Array.isArray(detail.commits) ? detail.commits : [];
        container.append(node('h4','상세 업데이트 설명'));
        if (commits.length) {
            for(const commit of commits) {
                if(!SHA.test(commit.sha))continue;
                const item=node('div',undefined,'release-commit');
                item.append(node('p',text(commit.message),'release-message'),link(`변경 원문 ${commit.sha.slice(0,7)} ↗`,`https://github.com/Deflate76/StopAlcohol/commit/${commit.sha}`));
                container.append(item);
            }
        } else container.append(node('p',text(detail.message)||'동일한 소스를 다시 배포했습니다.','release-message'));
        const files=Array.isArray(detail.files) ? detail.files : [];
        const fileGroup=node('details',undefined,'release-files');
        fileGroup.append(node('summary',`변경 파일 ${files.length.toLocaleString('ko-KR')}개${detail.filesTruncated?' 이상':''}`));
        const ul=node('ul');
        const labels={added:'추가',modified:'수정',removed:'삭제',renamed:'이름 변경'};
        for(const file of files){const li=node('li');li.append(node('span',`${labels[file.status]||'변경'} · ${text(file.path)}`),node('small',`+${Number(file.additions)||0} / −${Number(file.deletions)||0}줄`));ul.append(li);}
        fileGroup.append(ul);
        if(detail.filesTruncated)fileGroup.append(node('p','대규모 변경은 일부 파일만 표시합니다. 전체 변경 원문에서 나머지를 확인할 수 있습니다.','release-muted'));
        container.append(fileGroup);
        const links=node('div',undefined,'release-links');
        // Only application-constructed GitHub URLs are clickable.
        const compareURL=text(detail.comparisonUrl);
        if(new RegExp('^https://github\\.com/Deflate76/StopAlcohol/(?:commit/[a-f0-9]{40}|compare/[a-f0-9]{40}\\.\\.\\.[a-f0-9]{40})$').test(compareURL))links.append(link('전체 변경 원문 ↗',compareURL));
        links.append(link('배포 결과 ↗',`https://github.com/Deflate76/StopAlcohol/actions/runs/${release.id.split('-')[0]}`));
        container.append(links);
    }
    async function loadDetails(release,container) {
        if(container.dataset.loading==='true')return;
        if(details.has(release.id)){renderDetails(container,release,details.get(release.id));return;}
        container.dataset.loading='true';container.replaceChildren(node('p','상세 내용을 불러오는 중…','release-muted'));
        try {
            const detail=await json(ARCHIVE+release.detailPath);
            if(detail.id!==release.id || detail.commit!==release.commit || !Array.isArray(detail.files) || !Array.isArray(detail.commits))throw new Error('Invalid release');
            details.set(release.id,detail);renderDetails(container,release,detail);
        } catch {
            container.replaceChildren(node('p','상세 내용을 불러오지 못했습니다. 아래 원문을 확인하거나 다시 시도해 주세요.','release-muted'));
            if(release.message)container.append(node('p',release.message,'release-message'));
            const retry=node('button','상세 다시 불러오기','release-secondary');retry.type='button';retry.addEventListener('click',()=>loadDetails(release,container));
            container.append(retry,link('업데이트 원문 ↗',`https://github.com/Deflate76/StopAlcohol/commit/${release.commit}`));
        } finally {delete container.dataset.loading;}
    }
    function render() {
        setVersion();
        const query=search.value.trim().toLocaleLowerCase();
        const filtered=releases.filter(row=>[row.version,row.title,row.deployedAt,formatReleaseDate(row.deployedAt),...row.changes].join(' ').toLocaleLowerCase().includes(query));
        const currentId=releases.find(row=>row.commit===currentCommit)?.id;
        list.replaceChildren();
        doc.getElementById('releaseHistoryCount').textContent=`${filtered.length.toLocaleString('ko-KR')}개 배포`;
        for(const release of filtered.slice(0,shown)) {
            const card=node('article',undefined,'release-card');
            const top=node('div',undefined,'release-card-heading');
            top.append(node('span',release.version,'release-version'));
            if(release.id===currentId)top.append(node('span','현재 배포','release-current-badge'));
            const time=node('time',formatReleaseDate(release.deployedAt));time.dateTime=release.deployedAt;top.append(time);card.append(top);
            card.append(node('h3',release.title));
            if(release.changes.length){const changes=node('ul',undefined,'release-changes');for(const change of release.changes)changes.append(node('li',change));card.append(changes);}
            const expand=node('details',undefined,'release-expand');const content=node('div',undefined,'release-detail-content');
            expand.append(node('summary','상세 내용 · 변경 파일 보기'),content);
            expand.addEventListener('toggle',()=>{if(expand.open)void loadDetails(release,content);});card.append(expand);list.append(card);
        }
        if(!filtered.length)list.append(node('p',query?'검색 결과가 없습니다.':'배포 이력을 불러오는 중입니다.','release-empty'));
        more.hidden=filtered.length<=shown;
    }
    async function refreshHistory(force=false) {
        if(loading)return loading;
        if(!force && now()-lastFetched<60000)return;
        refresh.disabled=true;
        loading=(async()=>{
            try {
                releases=normalizeHistory(await json(ARCHIVE+'index.json?t='+Math.floor(now()/60000)));
                lastFetched=now();saveCache();status.textContent='성공한 배포만 표시합니다. 배포 시각은 한국시간입니다.';
            } catch {status.textContent=releases.length?'저장된 이력을 표시하고 있습니다. 최신 이력은 다시 불러올 수 있습니다.':'배포 이력을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.';}
            render();
            // A new page can arrive before its post-deployment archive is ready.
            if(currentCommit && !releases.some(r=>r.commit===currentCommit) && pollCount<5){win.clearTimeout(poll);poll=win.setTimeout(()=>{pollCount++;void refreshHistory(true);},30000);}
        })().finally(()=>{loading=null;refresh.disabled=false;});
        return loading;
    }
    button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();render();void refreshHistory();});
    doc.getElementById('releaseHistoryClose').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>button.focus({preventScroll:true}));
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    search.addEventListener('input',()=>{shown=PAGE_SIZE;render();});
    more.addEventListener('click',()=>{shown+=PAGE_SIZE;render();});
    refresh.addEventListener('click',()=>{pollCount=0;void refreshHistory(true);});
    doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)void refreshHistory();});
    const ready=(async()=>{
        releases=cached();
        const [build,seed]=await Promise.allSettled([json('./app-build.json'),json('./release-history-seed.json')]);
        if(build.status==='fulfilled' && SHA.test(build.value?.commit))currentCommit=build.value.commit;
        if(!releases.length && seed.status==='fulfilled'){try{releases=normalizeHistory(seed.value);}catch{}}
        render();await refreshHistory(true);
    })();
    return {ready,refresh:refreshHistory};
}
if(typeof document!=='undefined')installReleaseHistory();
