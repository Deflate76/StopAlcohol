import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {logger} from 'firebase-functions';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {createScheduleService, ScheduleError} from './service.mjs';

const app = initializeApp();
const service = createScheduleService({db: getFirestore(app), messaging: getMessaging(app), log: (message, data) => logger.warn(message, data)});
const runtimeServiceAccount = 'daily-schedules-runtime@alcoholaway.iam.gserviceaccount.com';

export const dailyScheduleApi = onCall({
  region: 'asia-northeast3', enforceAppCheck: true,
  serviceAccount: runtimeServiceAccount,
  cors: ['https://www.alcoholaway.com', 'https://alcoholaway.com'],
  memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 5
}, async request => {
  try { return await service.api(request); }
  catch (error) {
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
