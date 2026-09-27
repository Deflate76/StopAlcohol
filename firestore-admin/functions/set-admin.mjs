// Run only from an operator's terminal with Application Default Credentials.
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
const [action,project,email,...extra]=process.argv.slice(2);
if(!['grant','revoke'].includes(action)||project!=='alcoholaway'||!email?.includes('@')||extra.length){
  console.error('사용법: node set-admin.mjs grant|revoke alcoholaway 관리자이메일');process.exit(1);
}
try{
  const auth=getAuth(initializeApp({credential:applicationDefault(),projectId:project}));
  const user=await auth.getUserByEmail(email);
  if(action==='grant'&&(user.disabled||!user.emailVerified||!user.providerData.some(p=>p.providerId==='google.com')))
    throw new Error('활성화된 Google 로그인 계정이며 이메일 인증이 완료되어야 합니다. 사이트에서 먼저 Google 로그인해 주세요.');
  const claims={...user.customClaims};
  if(action==='grant')claims.firestoreAdmin=true;else delete claims.firestoreAdmin;
  await auth.setCustomUserClaims(user.uid,claims);
  // Every API call checks the live claim, so a revoked admin is denied immediately.
  // No user data, existing unrelated claims, or project IAM membership is changed.
  const verified=await auth.getUser(user.uid);
  if((verified.customClaims?.firestoreAdmin===true)!==(action==='grant'))throw new Error('권한 변경을 재확인하지 못했습니다.');
  console.log(JSON.stringify({project,uid:user.uid,email:user.email,firestoreAdmin:verified.customClaims?.firestoreAdmin===true},null,2));
  console.log(action==='grant'?'관리자 페이지에서 권한 새로고침을 누르세요.':'관리자 권한이 해제되었습니다.');
}catch(error){console.error('권한 변경 실패:',error.message);process.exitCode=1;}
