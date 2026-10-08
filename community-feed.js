// Existing posts/comments schema. Reads start only on account binding or opening the feed.
const DAY = 86400000;
const READ_PREFIX = 'alcoholaway-community-read:';
export const SOBRIETY_RANGES = [
    {id:'month1', label:'1개월 미만', min:0, max:30},
    {id:'month3', label:'1~3개월', min:30, max:90},
    {id:'month6', label:'3~6개월', min:90, max:180},
    {id:'year1', label:'6개월~1년', min:180, max:365},
    {id:'year5', label:'1~5년', min:365, max:1825},
    {id:'year10', label:'5~10년', min:1825, max:3650},
    {id:'year10plus', label:'10년 이상', min:3650, max:Infinity}
];
export function postTime(value) {
    if (value == null || value === '' || typeof value === 'boolean') return NaN;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000 + (value.nanoseconds || 0) / 1000000;
    return new Date(value).getTime();
}
export function sobrietyDaysAtPost(post) {
    const start = postTime(post.authorQuitDate), end = postTime(post.createdAt);
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(0, (end - start) / DAY);
    return Number.isSafeInteger(post.authorDayAtWrite) && post.authorDayAtWrite >= 0 ? Math.max(0, post.authorDayAtWrite - 1) : null;
}
const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
export function filterCommunityPosts(posts, filters = {}) {
    const keyword = normalized(filters.keyword), author = normalized(filters.author);
    const from = filters.from ? Date.parse(`${filters.from}T00:00:00+09:00`) : -Infinity;
    const to = filters.to ? Date.parse(`${filters.to}T00:00:00+09:00`) + DAY : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return [];
    const range = SOBRIETY_RANGES.find(item => item.id === filters.duration);
    return posts.filter(post => {
        if (keyword && !normalized(post.content).includes(keyword)) return false;
        if (author && ![post.uid, post.author].some(value => normalized(value).includes(author))) return false;
        const time = postTime(post.createdAt);
        if ((filters.from || filters.to) && (!Number.isFinite(time) || time < from || time >= to)) return false;
        const days = range ? sobrietyDaysAtPost(post) : null;
        return !range || (days !== null && days >= range.min && days < range.max);
    });
}

// Stable across comment deletions/reordering. Store only opaque fingerprints, never comment text.
export function communityCommentId(postId, comment) {
    const value = JSON.stringify([postId, comment.uid ?? '', postTime(comment.createdAt), comment.text ?? '', comment.author ?? '']);
    let hash = 14695981039346656037n;
    for (let i = 0; i < value.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(i))) * 1099511628211n);
    return 'community-comment-' + hash.toString(16);
}

export function installCommunityFeed({doc=document, win=window, getUid, watchPosts, watchOwnPosts,
    cheers=[], dayAtWrite, isPending=()=>false, editPost, deletePost, addComment, deleteComment, openCommunity} = {}) {
    const get = id => doc.getElementById(id), list = get('postList'), notice = get('communityUnreadBtn');
    const postInput=get('postContent'), postCount=get('postCharacterCount');
    const segmenter=typeof win.Intl?.Segmenter==='function'?new win.Intl.Segmenter('ko',{granularity:'grapheme'}):null;
    function updatePostCount() {
        if(!postInput || !postCount)return;
        const value=postInput.value.normalize('NFC');
        const count=segmenter?Array.from(segmenter.segment(value)).length:Array.from(value).length;
        postCount.textContent=`${count.toLocaleString('ko-KR')}자`;
    }
    postInput?.addEventListener('input',updatePostCount);
    postInput?.addEventListener('compositionend',updatePostCount);
    updatePostCount();
    const inputs = {keyword:get('communityKeyword'), author:get('communityAuthor'), from:get('communityDateFrom'), to:get('communityDateTo'), duration:get('communityDuration')};
    const node = (tag, className, text) => {const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
    const action = (label, kind, callback, className='action-btn') => {
        const button=node('button',className,label);button.type='button';button.dataset.communityAction=kind;button.addEventListener('click',callback);return button;
    };
    if (inputs.duration) for (const range of SOBRIETY_RANGES) {const option=node('option','',range.label);option.value=range.id;inputs.duration.append(option);}
    let uid=null, generation=0, feedSequence=0, stopFeed=null, stopOwn=null, visible=false, loading=false, error='', ownError='';
    let posts=[], ownPosts=[], shown=50, defaultOpen=false, pinned=null, ledgerReady=false, seen=new Set();
    const expanded=new Map(), drafts=new Map();
    let unread=[];
    const filters = () => Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input?.value || '']));
    function saveSeen() {if(uid && ledgerReady)try{win.localStorage.setItem(READ_PREFIX+uid,JSON.stringify({version:1,seen:[...seen]}));}catch{}}
    function updateNotice() {
        unread=[];
        if (ledgerReady && !ownError) for (const post of ownPosts) {
            for (const comment of Array.isArray(post.comments) ? post.comments : []) {
                if (!comment || typeof comment!=='object' || !comment.uid || comment.uid===uid) continue;
                const id=communityCommentId(post.id,comment);
                if(!seen.has(id))unread.push({post,comment,id,time:postTime(comment.createdAt)||0});
            }
        }
        unread.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
        if (notice) {
            notice.hidden=!unread.length;notice.textContent=`🔔 새 댓글 ${unread.length}`;
            notice.setAttribute('aria-label',`내 글에 새 댓글 ${unread.length}개. 누르면 다음 새 댓글로 이동합니다.`);
        }
        const status=get('communityNotificationStatus');
        if(status)status.textContent=ownError || (unread.length ? `내 글에 읽지 않은 댓글 ${unread.length}개 · 알림을 누르면 해당 댓글로 이동합니다.` : '새 댓글 알림의 읽음 상태는 이 기기에 저장됩니다.');
    }
    function bindAccount(nextUid) {
        if(uid===nextUid)return;
        stopFeed?.();stopOwn?.();stopFeed=stopOwn=null;generation++;feedSequence++;
        uid=nextUid;visible=false;loading=false;posts=[];ownPosts=[];unread=[];pinned=null;error=ownError='';shown=50;
        expanded.clear();drafts.clear();seen=new Set();ledgerReady=false;defaultOpen=false;
        Object.values(inputs).forEach(input=>{if(input)input.value='';});
        if (uid) try {const saved=JSON.parse(win.localStorage.getItem(READ_PREFIX+uid));if(saved?.version===1 && Array.isArray(saved.seen)){seen=new Set(saved.seen.filter(id=>typeof id==='string'));ledgerReady=true;}}catch{}
        list?.replaceChildren();updateNotice();
        if(!uid)return;
        const owner=uid, epoch=generation, valid=()=>uid===owner && generation===epoch && getUid()===owner;
        stopOwn=watchOwnPosts(owner,(rows,{fromCache=false}={})=>{
            if(!valid())return;
            ownPosts=rows.filter(post=>post.uid===owner);ownError='';
            // Establish the first baseline from the server, not an incomplete offline cache.
            if(!ledgerReady && !fromCache){
                for(const post of ownPosts)for(const comment of Array.isArray(post.comments)?post.comments:[])if(comment && typeof comment==='object')seen.add(communityCommentId(post.id,comment));
                ledgerReady=true;saveSeen();
            }
            updateNotice();
            if(visible && pinned)render();
        },()=>{if(valid()){ownPosts=[];ownError='댓글 알림을 불러오지 못했습니다. 다시 로그인하거나 연결을 확인해 주세요.';updateNotice();}});
    }
    function dayBadge(record) {
        const day=dayAtWrite(record), label=day===null?'작성 당시 도전 일수 미상':`작성 당시 도전 ${day}일째`;
        const badge=node('span','day-badge',`D+${day??'?'}`);badge.title=label;badge.setAttribute('aria-label',label);return badge;
    }
    function renderPost(post) {
        const card=node('details','post-card');card.dataset.postId=post.id;card.open=expanded.get(post.id)??defaultOpen;
        if(post.uid===uid)card.classList.add('is-mine');
        if(post.id===pinned?.postId)card.classList.add('is-notification-target');
        const summary=node('summary','post-summary'), header=node('span','post-header');
        const author=node('span','post-author-group');author.append(node('strong','post-author',`${post.author||'익명의 생존자'}${post.uid===uid?' (나)':''}`),dayBadge(post));
        const date=postTime(post.createdAt), dateText=Number.isFinite(date)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):'작성일 미상';
        header.append(author,node('span','post-date',dateText));
        summary.append(header,node('span','post-preview',String(post.content??'')),node('span','post-summary-footer',`댓글 ${(Array.isArray(post.comments)?post.comments:[]).length}개 · 펼치기/접기`));card.append(summary);
        const body=node('div','post-expanded-content');body.append(node('div','post-author-id',`작성자 ID: ${post.uid||'미상'}`),node('div','post-body',String(post.content??'')));
        if(post.editedAt)body.append(node('small','post-edited','수정됨'));
        if(post.uid===uid){const buttons=node('div','post-actions');buttons.append(action('수정','edit',()=>editPost(post.id,encodeURIComponent(String(post.content??'')))),action('삭제','delete',()=>deletePost(post.id)));body.append(buttons);}
        const comments=node('div','comment-section');
        (Array.isArray(post.comments)?post.comments:[]).forEach((comment,index)=>{
            if(!comment || typeof comment!=='object')return;
            const row=node('div','comment-item');row.id=communityCommentId(post.id,comment);row.tabIndex=-1;
            if(row.id===pinned?.commentId)row.classList.add('comment-notification-focus');
            const reaction=cheers.find(item=>item.emoji===comment.text);
            row.append(node('strong','comment-author',comment.author||'익명의 생존자'),dayBadge(comment));
            const text=node('span',reaction?'comment-reaction':'comment-text',String(comment.text??''));
            if(reaction){text.setAttribute('role','img');text.setAttribute('aria-label',reaction.label);}row.append(text);
            if(comment.uid===uid){const button=action('지우기','delete-comment',()=>deleteComment(post.id,index));button.dataset.commentIndex=index;row.append(button);}
            comments.append(row);
        });
        const composer=node('div','comment-composer');composer.id=`cmtComposer_${post.id}`;
        const inputRow=node('div','comment-input-area'), input=node('input','comment-input');input.type='text';input.id=`cmtInput_${post.id}`;input.placeholder='응원의 댓글 달기...';input.setAttribute('aria-label','응원의 댓글');input.value=drafts.get(post.id)||'';
        input.addEventListener('input',()=>drafts.set(post.id,input.value));
        const send=async reaction=>{const owner=uid;try{await addComment(post.id,reaction);}finally{if(owner===uid)drafts.set(post.id,get(`cmtInput_${post.id}`)?.value??drafts.get(post.id)??'');}};
        input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();void send(null);}});
        inputRow.append(input,action('등록','comment',()=>void send(null),'comment-btn'));composer.append(inputRow,node('p','comment-reaction-hint','아이콘을 누르면 응원 댓글이 등록돼요.'));
        const reactions=node('div','comment-reactions');reactions.setAttribute('role','group');reactions.setAttribute('aria-label','아이콘으로 응원 댓글 보내기');
        for(const reaction of cheers){const button=action(reaction.emoji,'cheer',()=>void send(reaction.id),'comment-reaction-btn');button.dataset.cheerId=reaction.id;button.title=reaction.label;button.setAttribute('aria-label',`${reaction.label} 응원 댓글 보내기`);reactions.append(button);}
        composer.append(reactions);const status=node('p','comment-status',isPending(uid,post.id)?'등록 중…':'');status.id=`cmtStatus_${post.id}`;status.setAttribute('role','status');status.setAttribute('aria-live','polite');composer.append(status);
        composer.querySelectorAll('button').forEach(button=>{button.disabled=isPending(uid,post.id);});comments.append(composer);body.append(comments);card.append(body);
        card.addEventListener('toggle',()=>{if(card.isConnected)expanded.set(post.id,card.open);});
        return card;
    }
    function render() {
        if(!list)return;
        const active=doc.activeElement, focus=list.contains(active)&&active.matches('.comment-input,.comment-item')?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
        list.querySelectorAll('.comment-input').forEach(input=>{const id=input.closest('.post-card')?.dataset.postId;if(id)drafts.set(id,input.value);});
        list.querySelectorAll('.post-card').forEach(card=>expanded.set(card.dataset.postId,card.open));
        const values=filters(), badDates=values.from&&values.to&&values.from>values.to;
        const matching=filterCommunityPosts(posts,values);
        let displayed=matching.slice(0,shown);
        const target=pinned&&ownPosts.find(post=>post.id===pinned.postId);
        if(target){displayed=displayed.filter(post=>post.id!==target.id);displayed.unshift(target);expanded.set(target.id,true);}
        list.replaceChildren(...displayed.map(renderPost));
        if(!displayed.length)list.append(node('p','community-empty',error || (badDates?'작성 기간의 시작일은 종료일보다 늦을 수 없습니다.':loading?'통신을 불러오는 중…':posts.length?'검색 결과가 없습니다.':'아직 발송된 통신이 없습니다. 첫 생존 신고를 남겨보세요!')));
        const status=get('communityFilterStatus');if(status)status.textContent=error || (badDates?'작성 기간을 확인해 주세요.':`${loading?'불러오는 중 · ':''}전체 ${posts.length}개 중 ${matching.length}개${target?' · 알림 대상 글을 맨 위에 표시합니다.':''}`);
        const more=get('communityMore');if(more)more.hidden=matching.length<=shown;
        const back=get('communityBackToList');if(back)back.hidden=!pinned;
        if(focus){const target=get(focus.id);if(target){target.focus({preventScroll:true});if(target.classList.contains('comment-input'))target.setSelectionRange(focus.start,focus.end);}}
    }
    function show() {
        const owner=getUid();if(!owner)return;if(uid!==owner)bindAccount(owner);
        visible=true;if(stopFeed){render();return;}
        loading=true;error='';const epoch=generation, request=++feedSequence;render();
        const valid=()=>visible && uid===owner && getUid()===owner && epoch===generation && request===feedSequence;
        stopFeed=watchPosts(rows=>{if(!valid())return;posts=rows;loading=false;error='';render();},()=>{if(valid()){posts=[];loading=false;error='통신을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.';render();}});
    }
    function hide(){visible=false;feedSequence++;stopFeed?.();stopFeed=null;}
    function jumpToUnread() {
        const next=unread[0];if(!next || openCommunity()===false)return;
        pinned={postId:next.post.id,commentId:next.id};expanded.set(next.post.id,true);render();
        const target=get(next.id);
        if(target){target.classList.add('comment-notification-focus');target.scrollIntoView?.({behavior:win.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});target.focus({preventScroll:true});seen.add(next.id);saveSeen();updateNotice();}
    }
    notice?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();jumpToUnread();});
    Object.values(inputs).forEach(input=>input?.addEventListener('input',()=>{shown=50;pinned=null;render();}));
    get('communityClearFilters')?.addEventListener('click',()=>{Object.values(inputs).forEach(input=>{if(input)input.value='';});shown=50;pinned=null;render();});
    for(const [id,open] of [['communityExpandAll',true],['communityCollapseAll',false]])get(id)?.addEventListener('click',()=>{defaultOpen=open;expanded.clear();pinned=null;for(const post of posts)expanded.set(post.id,open);list.querySelectorAll('.post-card').forEach(card=>{card.open=open;});});
    get('communityMore')?.addEventListener('click',()=>{shown+=50;render();});
    get('communityRetry')?.addEventListener('click',()=>{hide();show();});
    get('communityBackToList')?.addEventListener('click',()=>{pinned=null;render();});
    return {bindAccount,show,hide,jumpToUnread,render,getUnread:()=>unread.map(item=>({postId:item.post.id,commentId:item.id}))};
}
