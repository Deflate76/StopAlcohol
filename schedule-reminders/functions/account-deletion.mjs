import {randomUUID, createHash} from 'node:crypto';

export class AccountDeletionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new AccountDeletionError(code, message); };
export const deletionJobRef = (db, uid) => db.collection('daily_schedule_queue').doc('account-deletion-' + createHash('sha256').update(uid).digest('hex'));
const PAGE = 100, LEASE = 10 * 60000, TOKEN_DRAIN = 70 * 60000;
const ROOTS = ['users', 'daily_schedule_accounts', 'daily_wisdom_accounts'];
const OWNED = [['drinking_sessions','userId'], ['fcmTokens','uid'],
  ['daily_schedule_queue','uid'], ['daily_schedule_devices','uid'], ['posts','uid']];

// The only deletion target is request.auth.uid; a client never supplies a path or UID.
export function createAccountDeletionService({db, auth, bucket, checkPermissions, now = Date.now,
  uuid = randomUUID, log = () => {}}) {
  const jobs = db.collection('daily_schedule_queue');

  async function readiness() {
    try { await checkPermissions(); }
    catch { fail('failed-precondition', '회원탈퇴 서버 설정이 아직 완료되지 않았습니다. 데이터는 삭제되지 않았습니다. 관리자에게 문의해 주세요.'); }
  }
  async function deleteOwned(collection, field, uid) {
    for (;;) {
      const snapshot = await db.collection(collection).where(field, '==', uid).limit(PAGE+1).get();
      // The durable deletion job shares the existing server-only queue namespace.
      const targets = snapshot.docs.filter(doc => doc.ref.path !== deletionJobRef(db,uid).path);
      if (!targets.length) return;
      for (const doc of targets) {
        // Device ownership can change when another account signs in on that browser.
        await db.runTransaction(async tx => {
          const fresh = await tx.get(doc.ref);
          if (fresh.exists && fresh.data()[field] === uid) tx.delete(doc.ref);
        });
        // These indexed records (including post comments) store their content inline.
      }
    }
  }
  async function deleteComments(uid) {
    let cursor = null;
    for (;;) {
      let query = db.collection('posts').orderBy('__name__').limit(PAGE);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      for (const doc of snapshot.docs) {
        if (!doc.data().comments?.some?.(comment => comment?.uid === uid)) continue;
        await db.runTransaction(async tx => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists || !Array.isArray(fresh.data().comments)) return;
          const original = fresh.data().comments;
          const comments = original.filter(comment => comment?.uid !== uid);
          if (comments.length !== original.length) tx.update(doc.ref, {comments});
        });
      }
      if (snapshot.size < PAGE) return;
      cursor = snapshot.docs.at(-1);
    }
  }
  async function deletePhotos(uid) {
    for (const root of ['health_records', 'pill_identification']) {
      // Trailing slash is essential: deleting alice must never match alice2.
      const prefix = `${root}/${uid}/`;
      for (;;) {
        const [files] = await bucket.getFiles({prefix, maxResults:PAGE, autoPaginate:false});
        if (!files.length) break;
        for (const file of files) await file.delete({ignoreNotFound:true});
      }
    }
  }
  async function clean(uid) {
    // Stop scheduled delivery and remove device registrations first.
    for (const [collection, field] of OWNED) await deleteOwned(collection, field, uid);
    await deleteComments(uid);
    await deletePhotos(uid);
    // recursiveDelete also removes descendants whose parent document is missing.
    for (const root of ROOTS) await db.recursiveDelete(db.collection(root).doc(uid));
  }

  async function process(ref) {
    const leaseId = uuid();
    const job = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().leaseUntil > now() || snap.data().retryAt > now()) return null;
      const next = {...snap.data(), leaseId, leaseUntil:now()+LEASE};
      tx.set(ref, next); return next;
    });
    if (!job) return {accepted:true, deleted:false};
    const uid = job.uid;
    if (job.kind !== 'account-deletion' || !uid || deletionJobRef(db,uid).path !== ref.path) return {accepted:false, deleted:false};
    try {
      await readiness();
      if (!job.authDeletedAt) {
        // Once accepted, reject new logins and token refreshes until cleanup completes.
        try { await auth.updateUser(uid, {disabled:true}); await auth.revokeRefreshTokens(uid); }
        catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      }
      await clean(uid);
      if (job.authDeletedAt) {
        await ref.delete();
        return {accepted:true, deleted:true};
      }
      try { await auth.deleteUser(uid); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      // Already-issued ID tokens can last an hour. Keep only the UID-keyed job
      // for a final sweep after they expire, then delete even this marker.
      await ref.set({kind:'account-deletion', uid, createdAt:job.createdAt, authDeletedAt:now(), retryAt:now()+TOKEN_DRAIN,
        leaseUntil:0, leaseId:null, attempts:0});
      return {accepted:true, deleted:true};
    } catch (error) {
      await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists || current.data().leaseId !== leaseId) return;
        const attempts = (current.data().attempts || 0)+1;
        tx.update(ref, {attempts, leaseUntil:0, leaseId:null,
          retryAt:now()+Math.min(60*60000, 60000*2**Math.min(attempts,6))});
      });
      // Never log a UID, email, photo path, token or medical record.
      log('account-deletion-retry', {code:error?.code || 'unknown'});
      return {accepted:true, deleted:false};
    }
  }
  async function api(request) {
    const uid = request.auth?.uid;
    if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) fail('unauthenticated', '본인 계정으로 로그인해 주세요.');
    if (request.auth.token?.firebase?.sign_in_provider === 'anonymous') fail('permission-denied', 'Google 로그인 후 이용해 주세요.');
    if (request.data?.action === 'status') { await readiness(); return {ready:true}; }
    if (request.data?.confirm !== true || Object.keys(request.data || {}).some(key => key !== 'confirm')) {
      fail('invalid-argument', '회원탈퇴 확인이 필요합니다.');
    }
    const age = now()/1000 - Number(request.auth.token?.auth_time);
    if (!Number.isFinite(age) || age < -60 || age > 300) fail('unauthenticated', '본인 확인을 위해 다시 로그인해 주세요.');
    await readiness(); // Missing permissions must fail before any write or deletion.
    const user = await auth.getUser(uid);
    if (user.disabled || Number(request.auth.token.auth_time)*1000 < Date.parse(user.tokensValidAfterTime || 0)) {
      fail('unauthenticated', '로그인 상태를 다시 확인해 주세요.');
    }
    const ref = deletionJobRef(db, uid);
    await db.runTransaction(async tx => {
      if (!(await tx.get(ref)).exists) tx.set(ref, {kind:'account-deletion', uid, createdAt:now(), retryAt:now(), leaseUntil:0, attempts:0});
    });
    return process(ref);
  }
  async function dispatch() {
    const due = await jobs.where('retryAt', '<=', now()).limit(5).get();
    for (const doc of due.docs) if (doc.data().kind === 'account-deletion') await process(doc.ref);
    return {processed:due.size};
  }
  return {api, dispatch};
}
