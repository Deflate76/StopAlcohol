import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {logger} from 'firebase-functions';
import {initializeApp, applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getStorage} from 'firebase-admin/storage';
import {getFirestore} from 'firebase-admin/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {createScheduleService, ScheduleError} from './service.mjs';
import {createWisdomService, WisdomError} from './wisdom.mjs';
import {createAccountDeletionService, AccountDeletionError, deletionJobRef} from './account-deletion.mjs';

const app = initializeApp();
const service = createScheduleService({db: getFirestore(app), messaging: getMessaging(app), log: (message, data) => logger.warn(message, data)});
const runtimeServiceAccount = 'daily-schedules-runtime@alcoholaway.iam.gserviceaccount.com';
const wisdomApi = createWisdomService({db:getFirestore(app)});
const deletionBucket = getStorage(app).bucket('alcoholaway.firebasestorage.app');
let deletionPermissionsUntil = 0;
async function checkDeletionPermissions() {
  if (deletionPermissionsUntil > Date.now()) return;
  const permissions = ['firebaseauth.users.get', 'firebaseauth.users.update', 'firebaseauth.users.delete'];
  const token = await applicationDefault().getAccessToken();
  const response = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects/alcoholaway:testIamPermissions', {
    method:'POST', headers:{Authorization:`Bearer ${token.access_token}`, 'Content-Type':'application/json'},
    body:JSON.stringify({permissions}), signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('permission-check-unavailable');
  const allowed = (await response.json()).permissions || [];
  if (!permissions.every(permission => allowed.includes(permission))) throw new Error('auth-permissions-missing');
  const [storagePermissions] = await deletionBucket.iam.testPermissions(['storage.objects.list','storage.objects.delete']);
  if (!storagePermissions['storage.objects.list'] || !storagePermissions['storage.objects.delete']) throw new Error('storage-permissions-missing');
  deletionPermissionsUntil = Date.now()+60000;
}
const deletionService = createAccountDeletionService({db:getFirestore(app), auth:getAuth(app), bucket:deletionBucket,
  checkPermissions:checkDeletionPermissions, log:(message,data)=>logger.warn(message,data)});

async function requireActiveAccount(request) {
  if (request.auth?.uid && (await deletionJobRef(getFirestore(app),request.auth.uid).get()).exists) {
    throw new HttpsError('failed-precondition', '회원탈퇴가 진행 중인 계정입니다.');
  }
}

export const deleteMyAccount = onCall({
  region:'asia-northeast3', enforceAppCheck:true, serviceAccount:runtimeServiceAccount,
  cors:['https://www.alcoholaway.com','https://alcoholaway.com'],
  memory:'512MiB', timeoutSeconds:540, minInstances:0, maxInstances:3, concurrency:1
}, async request => {
  try { return await deletionService.api(request); }
  catch (error) {
    if (error instanceof AccountDeletionError) throw new HttpsError(error.code,error.message);
    logger.error('account-deletion-api-failed',{code:error?.code || 'unknown'});
    throw new HttpsError('internal','탈퇴 결과를 확인하지 못했습니다. 잠시 후 로그인 상태를 확인해 주세요.');
  }
});

export const retryAccountDeletions = onSchedule({
  schedule:'every 5 minutes', timeZone:'Asia/Seoul', region:'asia-northeast3',
  serviceAccount:runtimeServiceAccount, memory:'512MiB', timeoutSeconds:540,
  maxInstances:1, concurrency:1, retryCount:3
}, async () => { logger.info('account-deletion-sweep',await deletionService.dispatch()); });

export const dailyWisdomApi = onCall({
  region:'asia-northeast3', enforceAppCheck:true,
  serviceAccount:runtimeServiceAccount,
  cors:['https://www.alcoholaway.com', 'https://alcoholaway.com'],
  memory:'256MiB', timeoutSeconds:30, minInstances:0, maxInstances:5
}, async request => {
  try { await requireActiveAccount(request); return await wisdomApi(request); }
  catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof WisdomError) throw new HttpsError(error.code, error.message);
    logger.error('daily-wisdom-api-failed', {code:error?.code || 'unknown'});
    throw new HttpsError('internal', '조언 기록을 불러오거나 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

export const dailyScheduleApi = onCall({
  region: 'asia-northeast3', enforceAppCheck: true,
  serviceAccount: runtimeServiceAccount,
  cors: ['https://www.alcoholaway.com', 'https://alcoholaway.com'],
  memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 5
}, async request => {
  try { await requireActiveAccount(request); return await service.api(request); }
  catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof ScheduleError) throw new HttpsError(error.code, error.message);
    logger.error('daily-schedule-api-failed', {code: error?.code || 'unknown'});
    throw new HttpsError('internal', '일정 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

export const dispatchDailyScheduleReminders = onSchedule({
  schedule: 'every 1 minutes', timeZone: 'Asia/Seoul', region: 'asia-northeast3',
  serviceAccount: runtimeServiceAccount,
  memory: '256MiB', timeoutSeconds: 120, maxInstances: 1, concurrency: 1,
  retryCount: 3, minBackoffSeconds: 30, maxBackoffSeconds: 120
}, async () => { logger.info('daily-schedule-dispatch', await service.dispatch()); });
