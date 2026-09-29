// Private advice history is served only through the authenticated callable API.
// No health records, prompts, nicknames or community messages are stored here.
export class WisdomError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new WisdomError(code, message); };
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(id);
const pageSize = 20;

export function createWisdomService({db, now = Date.now}) {
  const records = uid => db.collection('daily_wisdom_accounts').doc(uid).collection('entries');
  const view = snapshot => {
    const {text, createdAt, rating, ratedAt} = snapshot.data();
    return {id:snapshot.id, text, createdAt, rating:rating || 0, ratedAt:ratedAt || null};
  };
  return async request => {
    const uid = request.auth?.uid;
    if (!uid) fail('unauthenticated', '로그인 후 오늘의 조언을 이용해 주세요.');
    if (request.auth.token?.firebase?.sign_in_provider === 'anonymous') fail('permission-denied', 'Google 로그인 후 이용해 주세요.');
    const data = request.data || {};
    if (data.action === 'list') {
      let query = records(uid).orderBy('createdAt', 'desc');
      if (data.cursor) {
        if (!validId(data.cursor)) fail('invalid-argument', '조회 위치를 확인해 주세요.');
        const cursor = await records(uid).doc(data.cursor).get();
        if (!cursor.exists) fail('aborted', '목록을 다시 열어 주세요.');
        query = query.startAfter(cursor);
      }
      const snapshot = await query.limit(pageSize + 1).get();
      const page = snapshot.docs.slice(0, pageSize);
      return {items:page.map(view), cursor:snapshot.size > pageSize ? page.at(-1).id : null};
    }
    if (!validId(data.id)) fail('invalid-argument', '조언 기록을 확인해 주세요.');
    const ref = records(uid).doc(data.id);
    if (data.action === 'save') {
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 160 || /[\r\n\u0000-\u001f]/.test(text)) fail('invalid-argument', '조언은 160자 이내의 한 줄이어야 합니다.');
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) {
          if (snapshot.data().text !== text) fail('already-exists', '이미 저장된 조언입니다.');
          return {item:view(snapshot)};
        }
        const item = {text, createdAt:now(), rating:0, ratedAt:null};
        transaction.set(ref, item);
        return {item:{id:data.id, ...item}};
      });
    }
    if (data.action === 'rate') {
      if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) fail('invalid-argument', '별점은 1~5개 중 선택해 주세요.');
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) fail('not-found', '저장된 조언을 찾을 수 없습니다.');
        const patch = {rating:data.rating, ratedAt:now()};
        transaction.update(ref, patch);
        return {item:{...view(snapshot), ...patch}};
      });
    }
    fail('invalid-argument', '지원하지 않는 요청입니다.');
  };
}
