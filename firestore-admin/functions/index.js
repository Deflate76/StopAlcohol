import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {createAdminService,AdminError,PROJECT} from './service.mjs';
import {administratorAuthorization} from './authorization.mjs';
import {logger} from 'firebase-functions';

const credential=applicationDefault();
const app=initializeApp({credential,projectId:PROJECT});
const auth=getAuth(app);
const service=createAdminService({
  authorize:administratorAuthorization(uid=>auth.getUser(uid)),
  async request(method,path,body,options={}) {
    const access=await credential.getAccessToken();
    let response;
    try {
      response=await fetch('https://firestore.googleapis.com/v1/'+path,{
        method,headers:{Authorization:'Bearer '+access.access_token,'Content-Type':'application/json'},
        ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(18000)
      });
    }catch{throw new AdminError('unavailable','Firestore 응답을 확인하지 못했습니다. 같은 요청을 다시 시도할 수 있습니다.');}
    if(response.status===404&&options.missing)return null;
    let data;try{data=await response.json();}catch{throw new AdminError('unavailable','Firestore 응답 형식을 확인하지 못했습니다.');}
    if(!response.ok) {
      const code=data.error?.status;
      const errors={
        ALREADY_EXISTS:['already-exists','같은 ID의 문서 또는 처리된 요청이 이미 있습니다.'],
        FAILED_PRECONDITION:['failed-precondition','원본 변경 여부 또는 검색 인덱스를 확인해 주세요.'],
        ABORTED:['aborted','동시에 변경된 내용이 있습니다. 다시 조회해 주세요.'],
        NOT_FOUND:['not-found','문서를 찾을 수 없습니다.'],
        PERMISSION_DENIED:['permission-denied','관리자 API의 Firestore 접근 권한을 확인해 주세요.'],
        INVALID_ARGUMENT:['invalid-argument','경로·필드 타입·검색 조건을 확인해 주세요.'],
        RESOURCE_EXHAUSTED:['resource-exhausted','요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.'],
        UNAVAILABLE:['unavailable','Firestore에 연결하지 못했습니다. 다시 시도해 주세요.'],
        DEADLINE_EXCEEDED:['deadline-exceeded','응답 시간이 초과되었습니다. 같은 요청을 다시 시도해 주세요.']
      };
      const [publicCode,message]=errors[code]||['internal','Firestore 요청을 완료하지 못했습니다.'];
      throw new AdminError(publicCode,message);
    }
    return data;
  }
});

export const firestoreAdminApi=onCall({
  region:'asia-northeast3',enforceAppCheck:true,
  cors:['https://www.alcoholaway.com','https://alcoholaway.com'],
  serviceAccount:'firestore-admin-console@alcoholaway.iam.gserviceaccount.com',
  memory:'256MiB',timeoutSeconds:60,minInstances:0,maxInstances:2,concurrency:8
},async request=>{
  try{return await service(request);}
  catch(error){
    if(error instanceof AdminError)throw new HttpsError(error.code,error.message,error.details);
    logger.error('Firestore admin request failed',{code:typeof error?.code==='string'?error.code.slice(0,60):'unknown'});
    throw new HttpsError('internal','관리자 요청을 완료하지 못했습니다. 관리자 API의 설정을 확인해 주세요.');
  }
});
