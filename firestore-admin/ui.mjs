import {TYPE_LABELS,pathParts,validateFields,parseValue,valueText,summaryValue,diffFields,diffEntries,canonical} from './functions/value-codec.mjs';
import {collectFieldPaths} from './functions/field-paths.mjs';
import {mountValueGrid} from './grid-editor.mjs';

export function mountAdmin(document,connection) {
  const $=id=>document.getElementById(id),win=document.defaultView;
  const state={user:null,ready:false,authorized:false,generation:0,busy:false,collection:'',filter:null,pages:[''],page:0,next:'',document:null,dirty:false,raw:false,pending:null,collectionToken:'',subToken:'',collectionParent:'',confirm:null,fieldOptions:new Map(),fieldToken:'',fieldsTruncated:false};
  const grid=mountValueGrid(document);
  const stale=()=>Object.assign(new Error('이전 로그인 세션의 응답입니다.'),{stale:true});
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const button=(label,handler,className='')=>{const node=el('button',label,className);node.type='button';node.addEventListener('click',handler);return node;};
  const readonly=()=>state.document?.path.split('/')[0]==='_firestore_admin_audit';
  const setStatus=message=>{$('status').textContent=message;};
  const friendly=error=>{
    const code=(error?.code||'').replace('functions/','').replace('auth/','');
    if(['unavailable','not-found','internal','deadline-exceeded'].includes(code))return (error.message||'서버에 연결하지 못했습니다.')+' 관리자 API 배포와 연결 설정을 확인해 주세요.';
    if(code==='popup-blocked')return '로그인 팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.';
    if(code==='popup-closed-by-user')return '로그인이 취소되었습니다.';
    if(code==='unauthorized-domain')return '이 도메인을 Firebase Authentication의 승인된 도메인에 등록해 주세요.';
    return error?.message||'작업을 완료하지 못했습니다. 다시 시도해 주세요.';
  };
  function showError(error){$('errorText').textContent=friendly(error);$('errorBox').hidden=false;}
  function updateControls() {
    $('workspace').disabled=state.busy||!state.authorized;
    $('workspace').hidden=!state.authorized;$('accessGate').hidden=state.authorized;
    $('newDocument').disabled=!state.collection||state.collection.split('/')[0]==='_firestore_admin_audit';
    $('previousPage').disabled=state.page===0;$('nextPage').disabled=!state.next;
    $('dirtyBadge').hidden=!state.dirty;$('refreshSession').disabled=state.busy;
    $('loginButton').disabled=state.busy||!state.ready;
  }
  function dirty(value=true){state.dirty=value;updateControls();}
  function clearEditor() {
    grid.reset();
    state.document=null;state.dirty=false;state.raw=false;state.pending=null;state.subToken='';
    $('editorEmpty').hidden=false;$('editorContent').hidden=true;
    for(const id of ['fieldList','subcollectionList'])$(id).replaceChildren();
    for(const id of ['documentPath','documentMeta'])$(id).textContent='';
    $('rawFields').value='';$('newId').value='';$('rawMode').checked=false;
    $('moreSubcollections').hidden=true;
  }
  function clearData(){
    clearEditor();state.collection='';state.filter=null;state.pages=[''];state.page=0;state.next='';state.collectionToken='';state.collectionParent='';
    $('collectionList').replaceChildren();$('documentList').replaceChildren();$('breadcrumbs').replaceChildren();
    $('currentCollection').textContent='컬렉션을 선택하세요';$('collectionContext').textContent='데이터베이스 루트';
    $('pathInput').value='';$('filterField').value='';$('filterValue').value='';$('pageNumber').textContent='—';$('moreCollections').hidden=true;
    resetFilterFields();
    finishConfirm(false);$('changeList').replaceChildren();$('confirmPath').textContent='';$('deleteConfirmInput').value='';$('confirmDialog').dataset.deletePath='';$('errorText').textContent='';
  }
  function lockAccess(error){
    state.generation++;state.authorized=false;state.busy=false;clearData();$('roleBadge').textContent='접근 제한';$('roleBadge').className='badge';
    $('gateTitle').textContent='관리자 권한을 확인해 주세요';$('gateText').textContent=friendly(error);updateControls();
  }
  async function api(data){
    const generation=state.generation;
    try{const result=await connection.call(data);if(generation!==state.generation)throw stale();return result;}
    catch(error){if(generation!==state.generation)throw stale();if(/(?:^|\/)(permission-denied|unauthenticated)$/.test(error.code||''))lockAccess(error);throw error;}
  }
  async function run(task){
    if(state.busy)return;const generation=state.generation;state.busy=true;$('errorBox').hidden=true;updateControls();
    try{await task();}catch(error){if(!error.stale){showError(error);if(!state.authorized){$('gateTitle').textContent='관리자 연결·권한을 확인해 주세요';$('gateText').textContent=friendly(error);}}}
    finally{if(generation===state.generation){state.busy=false;updateControls();}}
  }
  function finishConfirm(answer){
    const resolve=state.confirm;state.confirm=null;if($('confirmDialog').open)$('confirmDialog').close();if(resolve)resolve(answer);
  }
  function confirm({title,description,path='',changes=[],accept='확인',deleting=false}){
    $('confirmTitle').textContent=title;$('confirmDescription').textContent=description;$('confirmPath').textContent=path;$('confirmPath').hidden=!path;
    $('changeList').replaceChildren();$('deleteConfirmLabel').hidden=!deleting;$('deleteConfirmInput').value='';
    for(const change of changes){
      const row=el('div',undefined,'change-row');row.append(el('span',({add:'추가',change:'수정',delete:'삭제'})[change.kind],'change-kind '+change.kind),el('strong',change.key));
      if(change.before)row.append(el('p','이전 · '+TYPE_LABELS[Object.keys(change.before)[0]]+' · '+summaryValue(change.before,300)));
      if(change.after)row.append(el('p','이후 · '+TYPE_LABELS[Object.keys(change.after)[0]]+' · '+summaryValue(change.after,300)));
      $('changeList').append(row);
    }
    $('acceptConfirm').textContent=accept;$('acceptConfirm').className=deleting?'primary danger':'primary';$('acceptConfirm').disabled=deleting;
    $('confirmDialog').dataset.deletePath=deleting?path:'';
    return new Promise(resolve=>{state.confirm=resolve;$('confirmDialog').showModal();(deleting?$('deleteConfirmInput'):$('cancelConfirm')).focus();});
  }
  const discard=()=>!state.dirty?Promise.resolve(true):confirm({title:'저장하지 않은 변경사항',description:'현재 편집 내용을 버리고 이동할까요?',accept:'버리고 이동'});
  function resetFilterFields(){
    state.fieldOptions.clear();state.fieldToken='';state.fieldsTruncated=false;
    $('filterField').value='';mergeFilterFields([]);$('filterCustomLabel').hidden=true;
  }
  function mergeFilterFields(fields=[],truncated=false){
    const current=$('filterField').value,choice=$('filterFieldSelect').value;
    for(const field of fields){
      if(!state.fieldOptions.has(field.path)&&state.fieldOptions.size>=1000){state.fieldsTruncated=true;continue;}
      const types=state.fieldOptions.get(field.path)||new Set();
      for(const type of field.types||[])types.add(type);
      state.fieldOptions.set(field.path,types);
    }
    state.fieldsTruncated||=truncated;
    const select=$('filterFieldSelect');select.replaceChildren();
    const placeholder=el('option','필드를 선택하세요');placeholder.value='';select.append(placeholder);
    let selected='';
    [...state.fieldOptions].sort(([a],[b])=>a.localeCompare(b)).forEach(([path,types],i)=>{
      const option=el('option',path+' · '+[...types].map(type=>TYPE_LABELS[type]||type).join('/'));
      option.value='field-'+i;option.dataset.path=path;select.append(option);if(path===current)selected=option.value;
    });
    const custom=el('option','직접 입력');custom.value='custom';select.append(custom);
    select.value=selected||(current||choice==='custom'?'custom':'');
    $('filterCustomLabel').hidden=select.value!=='custom';
    $('filterFieldHint').textContent='읽은 문서에서 찾은 필드 '+state.fieldOptions.size+'개'+(state.fieldsTruncated?' · 일부 필드는 직접 입력해 주세요.':' · 중첩 객체 필드도 선택할 수 있습니다.');
    $('moreFilterFields').hidden=!state.fieldToken;
  }
  function updateFilterType(){
    const string=$('filterType').value==='stringValue',option=$('filterOperator').querySelector('[value="STRING_CONTAINS"]');
    option.disabled=!string;option.hidden=!string;
    if(!string&&$('filterOperator').value==='STRING_CONTAINS')$('filterOperator').value='EQUAL';
    const contains=$('filterOperator').value==='STRING_CONTAINS';
    $('filterSearchHint').textContent=contains?'문자열 중간에 검색어가 들어 있는 문서를 찾습니다(대소문자 구분). 한 번에 최대 200개 문서를 확인하며 다음 검색 범위로 계속 진행할 수 있습니다.':'현재 컬렉션의 선택한 필드에서 검색합니다. 하위 컬렉션은 별도로 열어 검색하세요.';
    $('filterValue').disabled=$('filterType').value==='nullValue';
  }
  function breadcrumbs(path){
    $('breadcrumbs').replaceChildren(button('데이터베이스',()=>navigate('')));
    const parts=path?path.split('/'):[];for(let i=0;i<parts.length;i++){$('breadcrumbs').append(el('span','/'),button(parts[i],()=>navigate(parts.slice(0,i+1).join('/'))));}
    $('pathInput').value=path;
  }
  async function loadCollections(parent='',append=false){
    const result=await api({action:'collections',path:parent,...(append?{pageToken:state.collectionToken}:{})});
    state.collectionParent=parent;state.collectionToken=result.nextPageToken;
    $('collectionContext').textContent=parent||'데이터베이스 루트';if(!append)$('collectionList').replaceChildren();
    for(const id of result.collections){const path=(parent?parent+'/':'')+id;$('collectionList').append(button(id,()=>navigate(path),state.collection===path?'active':''));}
    if(!$('collectionList').children.length)$('collectionList').append(el('p','컬렉션이 없습니다. 전체 경로로 새 컬렉션을 열 수 있습니다.','empty'));
    $('moreCollections').hidden=!state.collectionToken;
  }
  async function loadDocuments(token=''){
    state.next='';$('documentList').replaceChildren(el('p','문서를 불러오는 중입니다.','empty'));$('currentCollection').textContent=state.collection;updateControls();
    const result=await api({action:'documents',path:state.collection,...(state.filter?{filter:state.filter}:{}),...(token?{pageToken:token}:{})});
    if(!state.filter)state.fieldToken=result.nextPageToken||'';
    mergeFilterFields(result.fieldPaths,result.fieldsTruncated);
    state.next=result.nextPageToken;$('documentList').replaceChildren();
    for(const doc of result.documents){
      const row=button('',()=>navigate(doc.path),'doc-row'+(state.document?.path===doc.path?' active':''));row.dataset.path=doc.path;
      row.append(el('span',doc.id,'doc-id mono'));
      if(!doc.exists)row.append(el('span','본문 없음 · 하위 경로','badge'));
      for(const preview of doc.preview)row.append(el('span',preview.name+' · '+preview.value,'doc-preview'));
      $('documentList').append(row);
    }
    if(!result.documents.length)$('documentList').append(el('p',result.scan?.hasMore?'이번 범위에는 일치하는 문서가 없습니다. 다음 검색 범위를 확인하세요.':state.filter?'이 범위에서 검색 결과가 없습니다.':'문서가 없습니다. 새 문서를 추가할 수 있습니다.','empty'));
    $('pageNumber').textContent=(state.page+1)+' 페이지';$('currentCollection').textContent=state.collection;
    $('nextPage').textContent=result.scan?'다음 검색 범위':'다음';
    setStatus(result.scan?'문서 '+result.scan.scanned+'개 확인 · 일치 '+result.documents.length+'개 표시 · '+(result.scan.hasMore?'아직 확인하지 않은 문서가 있습니다.':'컬렉션 끝까지 확인했습니다.'):'문서 '+result.documents.length+'개 표시'+(state.filter?' · 필드 검색 적용':'')+' · 한 페이지 최대 25개');updateControls();
  }
  async function loadSubcollections(append=false){
    if(!state.document||state.document.isNew)return;
    const path=state.document.path,result=await api({action:'collections',path,...(append?{pageToken:state.subToken}:{})});
    state.subToken=result.nextPageToken;if(!append)$('subcollectionList').replaceChildren();
    for(const id of result.collections)$('subcollectionList').append(button(id,()=>navigate(path+'/'+id)));
    if(!$('subcollectionList').children.length)$('subcollectionList').append(el('p','하위 컬렉션이 없습니다.','muted small-text'));
    $('moreSubcollections').hidden=!state.subToken;
  }
  const hints={timestampValue:'UTC 시각 · 2026-09-27T04:00:00.123456789Z',integerValue:'64비트 정수 · 숫자 그대로 입력',booleanValue:'true 또는 false',doubleValue:'숫자, NaN, Infinity, -Infinity',mapValue:'필드별 타입 JSON · {"name":{"stringValue":"이름"}}',arrayValue:'항목별 타입 JSON · [{"stringValue":"항목"}]',referenceValue:'projects/alcoholaway/databases/(default)/documents/컬렉션/문서ID',geoPointValue:'{"latitude":37.5,"longitude":127}',bytesValue:'Base64 문자열',nullValue:'값 없음'};
  const defaults={stringValue:'',integerValue:'0',doubleValue:'0',booleanValue:'false',nullValue:'null',timestampValue:'2026-01-01T00:00:00Z',mapValue:'{}',arrayValue:'[]',referenceValue:'projects/alcoholaway/databases/(default)/documents/collection/document',geoPointValue:'{"latitude":0,"longitude":0}',bytesValue:''};
  function fieldRow(key,value){
    const row=el('div',undefined,'field-row'),top=el('div',undefined,'field-top'),name=el('input'),type=el('select'),input=el('textarea'),hint=el('p',undefined,'field-hint');
    name.value=key;name.placeholder='필드 이름';name.setAttribute('aria-label','필드 이름');name.className='field-name';name.autocomplete='off';
    for(const [id,label] of Object.entries(TYPE_LABELS)){const option=el('option',label);option.value=id;type.append(option);}type.value=Object.keys(value)[0];type.className='field-type';type.setAttribute('aria-label','데이터 타입');
    input.value=valueText(value);input.className='field-value mono';input.setAttribute('aria-label',key+' 값');input.spellcheck=false;input.rows=['mapValue','arrayValue'].includes(type.value)?5:2;
    const remove=button('×',()=>{row.remove();dirty();},'field-remove');remove.setAttribute('aria-label',(key||'새 필드')+' 삭제');
    const gridButton=button(readonly()?'표로 보기':'표로 편집',()=>{
      try{grid.open({value:parseValue(type.value,input.value),title:name.value||'새 필드',readOnly:readonly(),onChange:value=>{input.value=valueText(value);dirty();}});}catch(error){showError(error);}
    },'small field-grid-button');
    const jsonDetails=el('details',undefined,'field-json');jsonDetails.append(el('summary','타입 JSON 보기 · 편집'));
    function hintUpdate(){
      hint.textContent=hints[type.value]||'문자열을 입력하세요.';input.readOnly=readonly()||type.value==='nullValue';
      const complex=['arrayValue','mapValue'].includes(type.value);gridButton.hidden=!complex;jsonDetails.hidden=!complex;input.rows=complex?5:2;
      if(complex)jsonDetails.append(input,hint);else row.append(input,hint);
    }
    name.disabled=type.disabled=remove.disabled=readonly();
    name.addEventListener('input',()=>dirty());input.addEventListener('input',()=>dirty());
    type.addEventListener('change',()=>{input.value=defaults[type.value];hintUpdate();dirty();});
    top.append(name,type,remove);row.append(top,gridButton,jsonDetails,input,hint);hintUpdate();return row;
  }
  function renderFields(fields){$('fieldList').replaceChildren();for(const [key,value] of Object.entries(fields))$('fieldList').append(fieldRow(key,value));}
  function readFields(){
    if(state.raw)return validateFields(JSON.parse($('rawFields').value));
    const fields=Object.create(null);
    for(const row of $('fieldList').children){const key=row.querySelector('.field-name').value;if(Object.hasOwn(fields,key))throw new Error('중복된 필드 이름: '+key);fields[key]=parseValue(row.querySelector('.field-type').value,row.querySelector('.field-value').value);}
    return validateFields(fields);
  }
  function renderDocument(doc){
    clearEditor();state.document=doc;$('editorEmpty').hidden=true;$('editorContent').hidden=false;
    $('documentPath').textContent=doc.isNew?state.collection+'/새 문서':doc.path;
    $('documentMeta').textContent=doc.isNew?'새 문서 만들기':doc.exists?'마지막 변경 · '+doc.updateTime:'문서 본문이 없습니다.';
    $('missingNotice').hidden=doc.isNew||doc.exists;$('readOnlyNotice').hidden=!readonly();$('newIdLabel').hidden=!doc.isNew;
    $('newId').value=doc.isNew?doc.path.split('/').at(-1):'';
    $('reloadDocument').disabled=$('exportDocument').disabled=!!doc.isNew;
    $('writeActions').hidden=$('addField').hidden=readonly();$('deleteDocument').hidden=!doc.exists;
    $('previewSave').textContent=doc.exists?'변경 확인 · 저장':'문서 만들기';$('newSubcollection').disabled=!!doc.isNew;
    $('rawMode').checked=false;$('rawFields').readOnly=readonly();$('rawEditor').hidden=true;$('fieldList').hidden=false;
    renderFields(doc.fields);breadcrumbs(doc.isNew?state.collection:doc.path);updateControls();
    const discovered=collectFieldPaths([doc]);mergeFilterFields(discovered.fieldPaths,discovered.fieldsTruncated);
    for(const row of $('documentList').children)row.classList.toggle('active',row.dataset.path===doc.path);
  }
  async function openPath(path){
    const parts=path?path.split('/'):[];if(path)pathParts(path,parts.length%2?'collection':'document');
    if(!path){clearEditor();state.collection='';state.filter=null;state.pages=[''];state.page=0;state.next='';resetFilterFields();$('documentList').replaceChildren(el('p','왼쪽 컬렉션을 선택하세요.','empty'));$('currentCollection').textContent='컬렉션을 선택하세요';$('pageNumber').textContent='—';breadcrumbs('');await loadCollections();setStatus('컬렉션을 선택하세요.');return;}
    const collection=parts.length%2?path:parts.slice(0,-1).join('/');
    if(state.collection!==collection){clearEditor();state.collection=collection;state.filter=null;state.pages=[''];state.page=0;state.next='';resetFilterFields();$('filterValue').value='';await loadCollections(parts.length%2?parts.slice(0,-1).join('/'):parts.slice(0,-2).join('/'));await loadDocuments();}
    else if(parts.length%2)await loadDocuments(state.pages[state.page]);
    if(parts.length%2){clearEditor();breadcrumbs(path);}
    else{const {document:doc}=await api({action:'get',path});renderDocument(doc);await loadSubcollections();setStatus(doc.exists?'문서를 불러왔습니다. 편집 후 변경사항을 확인해 주세요.':'문서 본문이 없는 경로입니다.');}
  }
  function navigate(path){return run(async()=>{if(await discard())await openPath(path.trim());});}
  async function save(){
    if(!state.document||readonly())return;
    const original=state.document,fields=readFields();
    let path=original.path;if(original.isNew){const id=$('newId').value.trim()||original.path.split('/').at(-1);if(id.includes('/'))throw new Error('문서 ID에는 /를 넣을 수 없습니다.');path=state.collection+'/'+id;pathParts(path);}
    const changes=diffFields(original.fields,fields);if(original.exists&&!changes.length){dirty(false);setStatus('변경된 내용이 없습니다.');return;}
    const details=diffEntries(original.fields,fields),extra=details.total>details.changes.length?' 전체 '+details.total+'개 변경 중 처음 '+details.changes.length+'개를 표시합니다.':'';
    if(!await confirm({title:original.exists?'변경사항을 저장할까요?':'새 문서를 만들까요?',description:(original.exists?'아래 변경사항을 운영 데이터에 반영합니다. 삭제한 필드는 문서에서도 제거됩니다.':'현재 컬렉션에 문서를 추가합니다.')+extra,path,changes:details.changes,accept:original.exists?'변경 저장':'문서 만들기'}))return;
    const payload={action:original.exists?'update':'create',path,fields,confirmPath:path,...(original.exists?{updateTime:original.updateTime}:{})};
    const fingerprint=canonical(payload);
    if(state.pending?.fingerprint!==fingerprint)state.pending={fingerprint,requestId:win.crypto.randomUUID()};
    const result=await api({...payload,requestId:state.pending.requestId});state.pending=null;dirty(false);
    await loadDocuments(state.pages[state.page]);await openPath(path);setStatus((result.replayed?'이전에 완료된 저장을 확인했습니다.':'문서를 저장했습니다.')+' · '+result.committedAt);
  }
  async function deleteCurrent(){
    const doc=state.document;if(!doc?.exists||readonly())return;
    if(!await confirm({title:'문서를 삭제할까요?',description:'복원할 수 없는 문서 삭제입니다. 하위 컬렉션이 있으면 삭제가 차단됩니다. 연결된 사진·Storage 파일은 삭제되지 않습니다.',path:doc.path,accept:'문서 삭제',deleting:true}))return;
    const payload={action:'delete',path:doc.path,confirmPath:doc.path,updateTime:doc.updateTime},fingerprint=canonical(payload);
    if(state.pending?.fingerprint!==fingerprint)state.pending={fingerprint,requestId:win.crypto.randomUUID()};
    await api({...payload,requestId:state.pending.requestId});clearEditor();breadcrumbs(state.collection);await loadDocuments(state.pages[state.page]);setStatus('문서를 삭제했습니다.');
  }
  async function session(user){
    const generation=state.generation;if(!user||user!==state.user)return;await connection.refresh();if(generation!==state.generation||user!==state.user)throw stale();
    const result=await api({action:'session'});if(result.admin!==true||result.uid!==user.uid)throw new Error('관리자 계정을 확인하지 못했습니다.');
    state.authorized=true;$('roleBadge').textContent='관리자';$('roleBadge').className='badge live';updateControls();await openPath('');
  }
  async function setUser(user){
    state.generation++;state.user=user;state.ready=true;state.authorized=false;state.busy=false;clearData();$('errorBox').hidden=true;
    $('accountName').textContent=user?(user.email||user.uid):'로그인하지 않음';$('accountUid').textContent=user?'UID · '+user.uid:'';
    $('loginButton').hidden=!!user;$('logoutButton').hidden=$('refreshSession').hidden=!user;$('roleBadge').textContent='접근 대기';$('roleBadge').className='badge';
    $('gateTitle').textContent=user?'관리자 권한 확인 중':'관리자 계정으로 로그인하세요';$('gateText').textContent='등록된 관리자만 Firestore 데이터를 볼 수 있습니다.';updateControls();
    if(user)await run(()=>session(user));else setStatus('Google 계정으로 로그인해 주세요.');
  }
  $('pathForm').addEventListener('submit',event=>{event.preventDefault();navigate($('pathInput').value);});
  $('rootButton').addEventListener('click',()=>navigate(''));
  document.querySelectorAll('[data-path]').forEach(node=>node.addEventListener('click',()=>navigate(node.dataset.path)));
  $('moreCollections').addEventListener('click',()=>run(()=>loadCollections(state.collectionParent,true)));
  $('moreSubcollections').addEventListener('click',()=>run(()=>loadSubcollections(true)));
  $('newDocument').addEventListener('click',()=>run(async()=>{if(await discard()){renderDocument({path:state.collection+'/'+win.crypto.randomUUID(),fields:{},exists:false,isNew:true,updateTime:''});dirty();$('newId').focus();}}));
  $('newId').addEventListener('input',()=>dirty());
  $('reloadDocument').addEventListener('click',()=>navigate(state.document.path));
  $('addField').addEventListener('click',()=>{$('fieldList').append(fieldRow('',{stringValue:''}));dirty();$('fieldList').lastElementChild.querySelector('input').focus();});
  $('rawFields').addEventListener('input',()=>dirty());
  $('rawMode').addEventListener('change',()=>{try{const fields=readFields();state.raw=$('rawMode').checked;if(state.raw)$('rawFields').value=JSON.stringify(fields,null,2);else renderFields(fields);$('rawEditor').hidden=!state.raw;$('fieldList').hidden=state.raw;$('addField').hidden=state.raw||readonly();}catch(error){$('rawMode').checked=state.raw;showError(error);}});
  $('previewSave').addEventListener('click',()=>run(save));$('deleteDocument').addEventListener('click',()=>run(deleteCurrent));
  $('newSubcollection').addEventListener('click',()=>{$('pathInput').value=state.document.path+'/';$('pathInput').focus();setStatus('전체 경로 입력란에 하위 컬렉션 이름을 붙여 열어 주세요.');});
  $('filterForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{if(!state.collection)throw new Error('컬렉션을 먼저 선택하세요.');const field=$('filterField').value.trim();if(!field)throw new Error('검색할 필드 경로를 입력하세요.');const value=parseValue($('filterType').value,$('filterValue').value);if(!await discard())return;clearEditor();state.filter={field,op:$('filterOperator').value,value};state.pages=[''];state.page=0;state.next='';breadcrumbs(state.collection);await loadDocuments();});});
  $('filterFieldSelect').addEventListener('change',()=>{
    const select=$('filterFieldSelect'),option=[...select.options].find(option=>option.value===select.value);
    $('filterCustomLabel').hidden=select.value!=='custom';
    if(select.value==='custom'){$('filterField').focus();return;}
    $('filterField').value=option?.dataset.path||'';
    const types=state.fieldOptions.get($('filterField').value);
    if(types?.size===1&&[...$('filterType').options].some(option=>option.value===[...types][0]))$('filterType').value=[...types][0];
    updateFilterType();
  });
  $('moreFilterFields').addEventListener('click',()=>run(async()=>{
    if(!state.collection||!state.fieldToken)return;
    const result=await api({action:'fieldPaths',path:state.collection,pageToken:state.fieldToken});
    state.fieldToken=result.nextPageToken||'';mergeFilterFields(result.fieldPaths,result.fieldsTruncated);
  }));
  $('filterType').addEventListener('change',updateFilterType);
  $('filterOperator').addEventListener('change',updateFilterType);
  $('clearFilter').addEventListener('click',()=>run(async()=>{if(!state.collection||!await discard())return;clearEditor();state.filter=null;state.pages=[''];state.page=0;state.next='';$('filterField').value='';$('filterValue').value='';await loadDocuments();}));
  $('nextPage').addEventListener('click',()=>run(async()=>{if(!state.next||!await discard())return;const token=state.next;clearEditor();state.pages[state.page+1]=token;state.page++;await loadDocuments(token);}));
  $('previousPage').addEventListener('click',()=>run(async()=>{if(!state.page||!await discard())return;clearEditor();state.page--;await loadDocuments(state.pages[state.page]);}));
  $('exportDocument').addEventListener('click',()=>{try{const blob=new Blob([JSON.stringify({project:'alcoholaway',path:state.document.path,updateTime:state.document.updateTime,fields:readFields()},null,2)],{type:'application/json'}),url=win.URL.createObjectURL(blob),a=el('a');a.href=url;a.download='firestore-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);setStatus('현재 편집 내용을 JSON으로 내보냈습니다.');}catch(error){showError(error);}});
  $('loginButton').addEventListener('click',()=>run(()=>connection.login()));
  $('logoutButton').addEventListener('click',async()=>{if(!await discard())return;await setUser(null);try{await connection.logout();}catch(error){showError(error);}});
  $('refreshSession').addEventListener('click',()=>run(async()=>{if(!await discard())return;clearData();await session(state.user);}));
  $('dismissError').addEventListener('click',()=>{$('errorBox').hidden=true;});
  $('confirmForm').addEventListener('submit',event=>{event.preventDefault();if(!$('acceptConfirm').disabled)finishConfirm(true);});
  $('cancelConfirm').addEventListener('click',()=>finishConfirm(false));
  $('confirmDialog').addEventListener('cancel',event=>{event.preventDefault();finishConfirm(false);});
  $('deleteConfirmInput').addEventListener('input',()=>{$('acceptConfirm').disabled=$('deleteConfirmInput').value!==$('confirmDialog').dataset.deletePath;});
  win.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  updateFilterType();updateControls();
  return {setUser,initializationError(error){state.generation++;state.ready=false;state.authorized=false;state.busy=false;clearData();$('gateTitle').textContent='관리자 연결을 확인해 주세요';$('gateText').textContent=friendly(error);showError(error);updateControls();},state};
}
