import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFirestore, collection, doc, setDoc, getDocs, query, where, serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {createGameAccount} from './game-account.js?v=20261017-1';

const app = initializeApp({apiKey:'AIzaSyBWDwueP3a0atxCqFIgqd96sgXc0EqYbEY', authDomain:'alcoholaway.firebaseapp.com',
    projectId:'alcoholaway', storageBucket:'alcoholaway.firebasestorage.app', messagingSenderId:'1001199235857',
    appId:'1:1001199235857:web:362c4aae36b44c7eae12b0', measurementId:'G-JBE26PCZMF'});
const auth = getAuth(app), db = getFirestore(app);

export function installGameSession({gameId, title, onAccount, onBest, beforeLeave}) {
    const el = id => document.getElementById(id);
    let redirect = 0;
    const account = createGameAccount({gameId, gameTitle:title,
        watchAuth:(change,error) => onAuthStateChanged(auth,change,error),
        readScores:async (uid, id) => {
            // Equality-only query uses the existing single-field index, with no new composite index.
            const snapshot = await getDocs(query(collection(db,'users',uid,'game_scores'),where('gameId','==',id)));
            return snapshot.docs.map(row => ({...row.data(),id:row.id}));
        },
        writeScore:(uid, id, payload) => setDoc(doc(db,'users',uid,'game_scores',id),{...payload,createdAt:serverTimestamp()}),
        onAccount(user, error) {
            clearTimeout(redirect);
            el('gameApp').hidden = !user; el('authGate').hidden = !!user;
            el('gameUserBadge').textContent = user ? `👤 ${user.displayName || user.email || '로그인 사용자'}` : '';
            onAccount?.(user);
            if (!user) {
                el('authGateMessage').textContent = error ? '로그인 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.' : '로그인이 필요합니다. Alcoholaway 로그인 화면으로 이동합니다.';
                if (!error) redirect = setTimeout(() => location.replace('../index.html?gameLoginRequired=1'),450);
            }
        },
        onStatus(message, error, retry) {
            el('scoreHistoryStatus').textContent = message; el('scoreHistoryStatus').classList.toggle('is-error',error);
            el('retryScoreButton').hidden = !retry;
        },
        onHistory(rows, best) {
            onBest?.(best); el('scoreHistorySummary').textContent = `내 최고 ${best.toLocaleString('ko-KR')}점`;
            const list = el('scoreHistoryList'); list.replaceChildren();
            for (const row of rows) {
                const item = document.createElement('li'), score = document.createElement('strong'), detail = document.createElement('span');
                score.textContent = `${(Number(row.score) || 0).toLocaleString('ko-KR')}점`;
                const time = Number(row.playedAt);
                const date = Number.isFinite(time) ? new Date(time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
                detail.textContent = `${row.outcome === 'victory' ? '완료' : row.outcome === 'report_return' ? '돌아가기' : '게임 종료'} · ${gameId === 'space' ? 'WAVE' : 'LEVEL'} ${Number(row.round) || 1} · ${date}`;
                item.append(score,detail); list.append(item);
            }
        }
    });
    el('refreshHistoryButton').addEventListener('click', () => void account.refresh());
    el('retryScoreButton').addEventListener('click', () => void account.retry());
    el('backButton').addEventListener('click', async () => {
        el('backButton').disabled = true;
        try {
            beforeLeave?.();
            let timeout;
            const saved = await Promise.race([account.flush(), new Promise(resolve => {timeout = setTimeout(() => resolve(false),5000);})]);
            clearTimeout(timeout);
            if (saved || confirm('점수가 아직 저장되지 않았습니다. 저장을 기다리지 않고 돌아갈까요?')) location.href = '../index.html';
        } finally {el('backButton').disabled = false;}
    });
    return account;
}
