import {createHash, randomUUID} from 'node:crypto';
import {deletionJobRef} from './account-deletion.mjs';

export class ScheduleError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ScheduleError(code, message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const PRESETS = new Set([0, 5, 10, 15, 30, 60, 120, 1440, 10080]);
const MIN_DATE = Date.UTC(2000, 0, 1), MAX_DATE = Date.UTC(2100, 0, 1);
const dateValue = value => Number.isSafeInteger(value) && value >= MIN_DATE && value < MAX_DATE;
const LEASE_MS = 180000;
const pageSize = 50;

export function normalizeEvent(input) {
  if (!input || !validId(input.id)) fail('invalid-argument', '일정 ID를 확인해 주세요.');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!title || title.length > 100 || note.length > 2000) fail('invalid-argument', '일정 제목은 100자, 메모는 2,000자 이내로 입력해 주세요.');
  if (!dateValue(input.startAt) || !dateValue(input.endAt) || input.endAt <= input.startAt) {
    fail('invalid-argument', '종료 날짜와 시각은 시작보다 나중이어야 합니다.');
  }
  const timeZone = input.timeZone;
  try {
    if (typeof timeZone !== 'string' || timeZone.length > 80) throw new Error();
    new Intl.DateTimeFormat('ko-KR', {timeZone}).format(0);
  } catch { fail('invalid-argument', '일정의 시간대를 확인해 주세요.'); }
  const reminderChoice = input.reminderChoice;
  let reminderAt = null;
  if (reminderChoice === 'custom') {
    if (!dateValue(input.reminderAt)) fail('invalid-argument', '알림 날짜와 시각을 입력해 주세요.');
    reminderAt = input.reminderAt;
  } else if (reminderChoice !== 'none') {
    if (typeof reminderChoice !== 'string' || !/^\d+$/.test(reminderChoice) || !PRESETS.has(Number(reminderChoice))) {
      fail('invalid-argument', '알림 시점을 다시 선택해 주세요.');
    }
    reminderAt = input.startAt - Number(reminderChoice) * 60000;
  }
  if (reminderAt !== null && reminderAt > input.startAt) fail('invalid-argument', '알림은 일정 시작 시각 또는 그 이전으로 선택해 주세요.');
  return {id: input.id, title, note, startAt: input.startAt, endAt: input.endAt, timeZone, reminderChoice, reminderAt};
}

function publicEvent(event) {
  const {id, title, note, startAt, endAt, timeZone, reminderChoice, reminderAt, revision, reminderStatus, sentAt} = event;
  return {id, title, note, startAt, endAt, timeZone, reminderChoice, reminderAt, revision, reminderStatus, sentAt: sentAt || null};
}

export function createScheduleService({db, messaging, now = Date.now, uuid = randomUUID, log = () => {}}) {
  const events = uid => db.collection('daily_schedule_accounts').doc(uid).collection('events');
  const queue = db.collection('daily_schedule_queue');
  const devices = db.collection('daily_schedule_devices');
  const queueRef = (uid, id) => queue.doc(hash(uid + '\0' + id));

  async function registerDevice(uid, token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || !/^[\w:.-]+$/.test(token)) {
      fail('invalid-argument', '푸시 토큰을 확인할 수 없습니다. 알림을 다시 허용해 주세요.');
    }
    // One token belongs to its most recently authenticated account, never multiple owners.
    await devices.doc(hash(token)).set({uid, token, updatedAt: now()});
  }

  async function api(request) {
    const uid = request.auth?.uid;
    if (!uid) fail('unauthenticated', '로그인 후 일정을 이용해 주세요.');
    if (request.auth?.token?.firebase?.sign_in_provider === 'anonymous') fail('permission-denied', 'Google 로그인 후 이용해 주세요.');
    const data = request.data || {};
    if (data.action === 'registerDevice') {
      await registerDevice(uid, data.pushToken);
      return {registered: true};
    }
    if (data.action === 'list' || data.action === 'listAll') {
      const all = data.action === 'listAll';
      if (!all && (!dateValue(data.from) || !dateValue(data.to) || data.to <= data.from || data.to - data.from > 2 * 86400000)) {
        fail('invalid-argument', '조회 날짜를 확인해 주세요.');
      }
      // Order only by startAt: use the built-in single-field index, no index deployment.
      // Scan bounded pages and return the cursor even for an empty overlap page.
      let query = all ? events(uid).orderBy('startAt', 'desc') : events(uid).where('startAt', '<', data.to).orderBy('startAt', 'desc');
      if (data.cursor) {
        if (!validId(data.cursor)) fail('invalid-argument', '조회 위치를 확인해 주세요.');
        const cursor = await events(uid).doc(data.cursor).get();
        if (!cursor.exists) fail('aborted', '목록이 변경되었습니다. 새로고침해 주세요.');
        query = query.startAfter(cursor);
      }
      const snapshot = await query.limit(pageSize).get();
      return {
        events: snapshot.docs.map(doc => doc.data()).filter(event => all || event.endAt > data.from).map(publicEvent),
        nextCursor: snapshot.size === pageSize ? snapshot.docs.at(-1).id : null
      };
    }
    if (data.action === 'get') {
      if (!validId(data.id)) fail('invalid-argument', '일정 ID를 확인해 주세요.');
      const snapshot = await events(uid).doc(data.id).get();
      if (!snapshot.exists) fail('not-found', '삭제되었거나 이 계정의 일정이 아닙니다.');
      return {event: publicEvent(snapshot.data())};
    }
    if (data.action !== 'save' && data.action !== 'delete') fail('invalid-argument', '지원하지 않는 일정 작업입니다.');
    if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) fail('invalid-argument', '일정을 다시 열어 주세요.');
    const event = data.action === 'save' ? normalizeEvent(data.event) : null;
    const id = event?.id || data.id;
    if (!validId(id)) fail('invalid-argument', '일정 ID를 확인해 주세요.');
    if (event && !validId(data.requestId)) fail('invalid-argument', '저장 요청 ID를 확인해 주세요.');
    const ref = events(uid).doc(id), jobRef = queueRef(uid, id);
    // Registering the device must succeed before promising a reminder to the user.
    if (event?.reminderAt !== null && event && data.pushToken) await registerDevice(uid, data.pushToken);
    return db.runTransaction(async tx => {
      const [oldSnapshot, jobSnapshot] = await Promise.all([tx.get(ref), tx.get(jobRef)]);
      const old = oldSnapshot.exists ? oldSnapshot.data() : null;
      const job = jobSnapshot.exists ? jobSnapshot.data() : null;
      if (event && old?.lastRequestId === data.requestId) return {event: publicEvent(old)};
      if (!event && !old) return {deleted: true};
      if ((old?.revision || 0) !== data.expectedRevision) fail('aborted', '다른 화면에서 일정이 변경되었습니다. 목록을 새로고침한 뒤 다시 열어 주세요.');
      if (job?.leaseUntil > now()) fail('aborted', '현재 알림을 발송 중입니다. 잠시 후 다시 시도해 주세요.');
      if (!event) { tx.delete(ref); tx.delete(jobRef); return {deleted: true}; }
      const sameReminder = !!old && old.reminderAt === event.reminderAt && old.startAt === event.startAt;
      if (event.reminderAt !== null && !sameReminder) {
        if (event.reminderAt <= now()) fail('invalid-argument', '선택한 알림 시각이 지났습니다. 미래 시각 또는 알림 없음을 선택해 주세요.');
        if (!data.pushToken) fail('failed-precondition', '이 기기의 푸시 알림을 먼저 허용해 주세요.');
      }
      const saved = {...event, revision: (old?.revision || 0) + 1, lastRequestId: data.requestId,
        createdAt: old?.createdAt || now(), updatedAt: now(),
        reminderStatus: event.reminderAt === null ? 'none' : sameReminder ? old.reminderStatus : 'pending',
        sentAt: sameReminder ? old.sentAt || null : null};
      tx.set(ref, saved);
      if (event.reminderAt === null || ['sent', 'partial', 'failed', 'missed'].includes(saved.reminderStatus)) tx.delete(jobRef);
      else tx.set(jobRef, {
        uid, eventId: id, revision: saved.revision,
        dueAt: sameReminder && job ? job.dueAt : event.reminderAt,
        attempts: sameReminder && job ? job.attempts : 0,
        deliveredTokens: sameReminder && job ? job.deliveredTokens || [] : [],
        leaseUntil: 0, leaseId: null
      });
      return {event: publicEvent(saved)};
    });
  }

  async function claim(ref) {
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const job = snapshot.data();
      if (job.dueAt > now() || job.leaseUntil > now()) return null;
      if ((await tx.get(deletionJobRef(db,job.uid))).exists) { tx.delete(ref); return null; }
      const eventRef = events(job.uid).doc(job.eventId), eventSnapshot = await tx.get(eventRef);
      const event = eventSnapshot.exists ? eventSnapshot.data() : null;
      if (!event || event.revision !== job.revision || event.reminderAt === null || ['sent', 'partial', 'none', 'failed', 'missed'].includes(event.reminderStatus)) {
        tx.delete(ref); return null;
      }
      if (event.endAt <= now() || now() - event.reminderAt > 86400000) {
        tx.update(eventRef, {reminderStatus: 'missed'}); tx.delete(ref); return null;
      }
      const leased = {...job, attempts: job.attempts + 1, leaseId: uuid(), leaseUntil: now() + LEASE_MS, dueAt: now() + LEASE_MS};
      tx.set(ref, leased);
      return {job: leased, event, eventRef};
    });
  }

  async function processJob(ref) {
    const claimed = await claim(ref);
    if (!claimed) return false;
    const {job, event, eventRef} = claimed;
    const delivered = new Set(job.deliveredTokens || []);
    let retry = false;
    try {
      const snapshot = await devices.where('uid', '==', job.uid).get();
      const recipients = snapshot.docs.filter(doc => !delivered.has(doc.id));
      if (!snapshot.size) retry = true;
      const startText = new Intl.DateTimeFormat('ko-KR', {timeZone: event.timeZone, month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(event.startAt);
      for (let offset = 0; offset < recipients.length; offset += 500) {
        if ((await deletionJobRef(db,job.uid).get()).exists) break;
        const batch = recipients.slice(offset, offset + 500);
        const result = await messaging.sendEachForMulticast({
          tokens: batch.map(doc => doc.data().token),
          data: {kind: 'daily-schedule', title: '일정 리마인드', body: `${event.title}\n${startText}`,
            url: `https://www.alcoholaway.com/?schedule=${encodeURIComponent(event.id)}`,
            tag: `daily-schedule-${event.id}-${event.revision}`},
          webpush: {headers: {Urgency: 'high', TTL: String(Math.max(1, Math.min(3600, Math.floor((event.endAt - now()) / 1000))))}}
        });
        for (let index = 0; index < result.responses.length; index++) {
          const response = result.responses[index], device = batch[index];
          if (response.success) { delivered.add(device.id); continue; }
          if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(response.error?.code)) {
            // Do not delete a token reassigned to another account while sending.
            await db.runTransaction(async tx => {
              const current = await tx.get(device.ref);
              if (current.exists && current.data().uid === job.uid) tx.delete(device.ref);
            });
          } else retry = true;
        }
      }
    } catch (error) { retry = true; log('schedule-push-retry', {code: error?.code || 'unknown'}); }
    await db.runTransaction(async tx => {
      const [currentJob, currentEvent] = await Promise.all([tx.get(ref), tx.get(eventRef)]);
      if (!currentJob.exists || currentJob.data().leaseId !== job.leaseId || !currentEvent.exists || currentEvent.data().revision !== job.revision) return;
      const dueAt = now() + Math.min(16, 2 ** (job.attempts - 1)) * 60000;
      if (retry && job.attempts < 5 && dueAt < event.endAt && dueAt < event.reminderAt + 86400000) {
        tx.update(ref, {dueAt, leaseId: null, leaseUntil: 0, deliveredTokens: [...delivered]});
        tx.update(eventRef, {reminderStatus: 'pending'});
      } else {
        tx.delete(ref);
        tx.update(eventRef, {reminderStatus: delivered.size ? (retry ? 'partial' : 'sent') : 'failed', sentAt: delivered.size ? now() : null});
      }
    });
    return true;
  }

  async function dispatch() {
    const started = Date.now();
    let processed = 0;
    // Each job is transactionally leased; duplicated/overlapping Scheduler invocations are safe.
    while (Date.now() - started < 50000) {
      const snapshot = await queue.where('dueAt', '<=', now()).orderBy('dueAt').limit(100).get();
      if (!snapshot.size) break;
      for (let offset = 0; offset < snapshot.docs.length; offset += 5) {
        const results = await Promise.allSettled(snapshot.docs.slice(offset, offset + 5).map(doc => processJob(doc.ref)));
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value) processed++;
          else if (result.status === 'rejected') log('schedule-job-failed', {code: result.reason?.code || 'unknown'});
        });
        if (Date.now() - started >= 50000) break;
      }
      if (snapshot.size < 100) break;
    }
    return {processed};
  }
  return {api, dispatch, processJob};
}
