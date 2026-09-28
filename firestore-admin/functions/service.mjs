import {createHash} from 'node:crypto';
import {pathParts,validateFields,validateValue,validTimestamp,canonical,summaryValue} from './value-codec.mjs';
import {parseFieldPath,formatFieldPath,fieldValue,collectFieldPaths} from './field-paths.mjs';

export class AdminError extends Error {
  constructor(code,message,details){super(message);this.code=code;this.details=details;}
}
const fail=(code,message,details)=>{throw new AdminError(code,message,details);};
export const PROJECT='alcoholaway';
export const AUDIT='_firestore_admin_audit';
const ROOT='projects/'+PROJECT+'/databases/(default)/documents';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const boundedToken=value=>{if(value!==undefined && (typeof value!=='string'||value.length>20000))fail('invalid-argument','다음 페이지 정보가 올바르지 않습니다.');return value||'';};
const segmentPath=parts=>parts.map(encodeURIComponent).join('/');
const nameOf=path=>ROOT+(path?'/'+path:'');
const apiPath=path=>ROOT+(path?'/'+segmentPath(pathParts(path)):'');
function validatePath(path,kind='document',root=false) {
  try{return pathParts(path,kind,root);}catch(e){fail('invalid-argument',e.message);}
}
function fieldsOrFail(fields) {try{return validateFields(fields);}catch(e){fail('invalid-argument',e.message);}}
function summary(document) {
  const path=document.name.slice(ROOT.length+1),fields=document.fields||{};
  return {path,id:path.split('/').at(-1),exists:!!document.updateTime,updateTime:document.updateTime||'',
    fieldCount:Object.keys(fields).length,preview:Object.entries(fields).slice(0,3).map(([name,value])=>({name:name.slice(0,80),value:summaryValue(value)}))};
}
function queryField(field) {
  try{return formatFieldPath(parseFieldPath(field));}catch(error){fail('invalid-argument',error.message);}
}
export function createAdminService({authorize,request,now=()=>new Date().toISOString()}) {
  async function get(path) {return await request('GET',apiPath(path),undefined,{missing:true});}
  async function collections(path,token='',pageSize=50) {
    return await request('POST',apiPath(path)+':listCollectionIds',{pageSize,...(token?{pageToken:token}:{})});
  }
  async function auditRetry(id,uid,fingerprint) {
    const existing=await get(AUDIT+'/'+id);
    if(!existing)return null;
    if(existing.fields?.actorUid?.stringValue!==uid||existing.fields?.fingerprint?.stringValue!==fingerprint)
      fail('already-exists','변경 요청 ID가 다른 작업에 사용되었습니다. 다시 확인해 주세요.');
    return {ok:true,replayed:true,requestId:id,committedAt:existing.fields?.at?.timestampValue||''};
  }
  return async function handle(call) {
    const identity=await authorize(call),uid=identity.uid;
    const data=call.data;
    if(!data||typeof data!=='object'||Array.isArray(data))fail('invalid-argument','요청 형식이 올바르지 않습니다.');
    const {action}=data;
    if(action==='session')return {project:PROJECT,database:'(default)',uid,admin:true};
    if(action==='collections') {
      validatePath(data.path,'document',true);
      const result=await collections(data.path,boundedToken(data.pageToken));
      return {collections:result.collectionIds||[],nextPageToken:result.nextPageToken||''};
    }
    if(action==='documents'||action==='fieldPaths') {
      const parts=validatePath(data.path,'collection'),parent=parts.slice(0,-1).join('/'),id=parts.at(-1);
      const token=boundedToken(data.pageToken);
      if(!data.filter||action==='fieldPaths') {
        const params=new URLSearchParams({pageSize:'25',showMissing:'true'});
        if(token)params.set('pageToken',token);
        const result=await request('GET',apiPath(parent)+'/'+encodeURIComponent(id)+'?'+params);
        return {documents:action==='fieldPaths'?[]:(result.documents||[]).map(summary),nextPageToken:result.nextPageToken||'',filtered:false,...collectFieldPaths(result.documents||[])};
      }
      const filter=data.filter,field=queryField(filter.field);
      const supported=['EQUAL','LESS_THAN','LESS_THAN_OR_EQUAL','GREATER_THAN','GREATER_THAN_OR_EQUAL','ARRAY_CONTAINS','STRING_CONTAINS'];
      if(!supported.includes(filter.op))fail('invalid-argument','지원하지 않는 검색 조건입니다.');
      try{validateValue(filter.value);}catch(e){fail('invalid-argument',e.message);}
      const type=Object.keys(filter.value)[0];
      if(['arrayValue','mapValue','bytesValue'].includes(type))fail('invalid-argument','검색 값은 문자열·숫자·날짜·참조 등의 단일 값으로 입력하세요.');
      const inequality=filter.op.includes('THAN'),context=hash({path:data.path,filter});
      const contains=filter.op==='STRING_CONTAINS';
      if(contains&&(type!=='stringValue'||!filter.value.stringValue.length||filter.value.stringValue.length>1000))fail('invalid-argument','포함 검색에는 1~1000자의 문자열을 입력하세요.');
      const special=type==='nullValue'?'IS_NULL':type==='doubleValue'&&filter.value.doubleValue==='NaN'?'IS_NAN':null;
      const where=special&&filter.op==='EQUAL'?{unaryFilter:{field:{fieldPath:field},op:special}}:{fieldFilter:{field:{fieldPath:field},op:filter.op,value:filter.value}};
      const query={from:[{collectionId:id}],...(contains?{select:{fields:[{fieldPath:field}]}}:{where}),
        orderBy:[...(inequality?[{field:{fieldPath:field},direction:'ASCENDING'}]:[]),{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:contains?201:26};
      if(token) {
        let cursor;try{cursor=JSON.parse(Buffer.from(token,'base64url').toString());}catch{fail('invalid-argument','검색 페이지 정보가 손상되었습니다. 처음부터 조회하세요.');}
        if(cursor.context!==context||!Array.isArray(cursor.values)||cursor.values.length!==(inequality?2:1))fail('invalid-argument','검색 조건이 변경되었습니다. 처음부터 조회하세요.');
        try{cursor.values.forEach(v=>validateValue(v));}catch{fail('invalid-argument','검색 페이지 값이 올바르지 않습니다.');}
        const reference=cursor.values.at(-1)?.referenceValue;
        if(typeof reference!=='string'||!reference.startsWith(nameOf(data.path)+'/')||reference.slice(nameOf(data.path).length+1).includes('/'))fail('invalid-argument','검색 페이지의 문서 경로를 확인할 수 없습니다.');
        query.startAt={values:cursor.values,before:false};
      }
      const response=await request('POST',apiPath(parent)+':runQuery',{structuredQuery:query});
      if(contains) {
        const candidates=response.map(row=>row.document).filter(Boolean),page=[];let scanned=0,last;
        for(const document of candidates.slice(0,200)) {
          scanned++;last=document;
          const value=fieldValue(document.fields,filter.field)?.stringValue;
          if(typeof value==='string'&&value.includes(filter.value.stringValue))page.push(document);
          if(page.length===25)break;
        }
        const hasMore=scanned<candidates.length;
        return {documents:page.map(summary),filtered:true,scan:{scanned,hasMore},
          nextPageToken:hasMore?Buffer.from(JSON.stringify({context,values:[{referenceValue:last.name}]})).toString('base64url'):'',...collectFieldPaths(page)};
      }
      const documents=response.map(row=>row.document).filter(Boolean),page=documents.slice(0,25),last=page.at(-1);
      const values=last?[...(inequality?[fieldValue(last.fields,filter.field)]:[]),{referenceValue:last.name}]:[];
      return {documents:page.map(summary),nextPageToken:documents.length>25?Buffer.from(JSON.stringify({context,values})).toString('base64url'):'',filtered:true,...collectFieldPaths(page)};
    }
    if(action==='get') {
      validatePath(data.path);const document=await get(data.path);
      return {document:document?{path:data.path,exists:true,fields:document.fields||{},createTime:document.createTime||'',updateTime:document.updateTime}: {path:data.path,exists:false,fields:{},updateTime:''}};
    }
    if(!['create','update','delete'].includes(action))fail('invalid-argument','지원하지 않는 관리자 작업입니다.');
    validatePath(data.path);
    if(data.path.split('/')[0]===AUDIT)fail('permission-denied','관리자 작업 이력은 이 화면에서 변경할 수 없습니다.');
    if(data.confirmPath!==data.path)fail('invalid-argument','변경할 문서 경로를 확인해 주세요.');
    if(typeof data.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.requestId))
      fail('invalid-argument','변경 요청 ID가 올바르지 않습니다.');
    const fields=action==='delete'?null:fieldsOrFail(data.fields);
    if(action!=='create'&&!validTimestamp(data.updateTime))fail('invalid-argument','원본 문서를 새로 불러온 후 다시 시도하세요.');
    const fingerprint=hash({action,path:data.path,fields,updateTime:data.updateTime||''});
    const already=await auditRetry(data.requestId,uid,fingerprint);if(already)return already;
    const existing=await get(data.path);
    if(action==='create'&&existing)fail('already-exists','같은 ID의 문서가 이미 있습니다.');
    if(action!=='create'&&(!existing||existing.updateTime!==data.updateTime))fail('failed-precondition','문서가 다른 곳에서 변경되었거나 삭제되었습니다. 원본을 다시 불러와 주세요.',{reason:'conflict'});
    if(action==='delete') {
      const children=await collections(data.path,'',1);
      if(children.collectionIds?.length)fail('failed-precondition','하위 컬렉션이 있는 문서는 삭제할 수 없습니다. 하위 문서를 먼저 확인하세요.',{reason:'children'});
    }
    // Recheck the current account's claim immediately before a privileged commit.
    const confirmed=await authorize(call);if(confirmed.uid!==uid)fail('permission-denied','관리자 계정이 변경되었습니다.');
    const stamp=now(),auditFields={actorUid:{stringValue:uid},action:{stringValue:action},documentPath:{stringValue:data.path},
      at:{timestampValue:stamp},fingerprint:{stringValue:fingerprint},requestId:{stringValue:data.requestId}};
    const write=action==='delete'?{delete:nameOf(data.path),currentDocument:{updateTime:data.updateTime}}:
      {update:{name:nameOf(data.path),fields},currentDocument:action==='create'?{exists:false}:{updateTime:data.updateTime}};
    try {
      const result=await request('POST',ROOT+':commit',{writes:[write,{update:{name:nameOf(AUDIT+'/'+data.requestId),fields:auditFields},currentDocument:{exists:false}}]});
      return {ok:true,replayed:false,requestId:data.requestId,committedAt:result.commitTime||stamp,updateTime:result.writeResults?.[0]?.updateTime||''};
    }catch(error) {
      // If a retry races a successful request, the immutable audit is the receipt.
      if(['already-exists','failed-precondition','aborted','deadline-exceeded','unavailable'].includes(error.code)) {
        const receipt=await auditRetry(data.requestId,uid,fingerprint).catch(()=>null);if(receipt)return receipt;
      }
      throw error;
    }
  };
}
