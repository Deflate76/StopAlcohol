import {AdminError} from './service.mjs';

export function administratorAuthorization(getUser) {
  return async request=>{
    if(!request.app)throw new AdminError('unauthenticated','앱 인증을 완료하지 못했습니다. 새로고침해 주세요.');
    if(!request.auth)throw new AdminError('unauthenticated','Google 계정으로 로그인해 주세요.');
    if(request.auth.token.firestoreAdmin!==true)throw new AdminError('permission-denied','관리자로 등록된 계정만 접근할 수 있습니다.');
    // Never trust a profile document, an email allowlist, or a stale claim alone.
    let user;try{user=await getUser(request.auth.uid);}catch{throw new AdminError('permission-denied','계정의 관리자 권한을 확인할 수 없습니다.');}
    if(user.uid!==request.auth.uid||user.disabled||!user.emailVerified||user.customClaims?.firestoreAdmin!==true)
      throw new AdminError('permission-denied','관리자 권한이 없거나 해제되었습니다.');
    const validAfter=Date.parse(user.tokensValidAfterTime||''),authTime=Number(request.auth.token.auth_time)*1000;
    if(!Number.isFinite(authTime)||(Number.isFinite(validAfter)&&authTime<validAfter))
      throw new AdminError('unauthenticated','로그인이 만료되었습니다. 로그아웃 후 다시 로그인하세요.');
    return {uid:user.uid};
  };
}
