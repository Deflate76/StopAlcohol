// Small transport-independent account boundary, shared by the new games.
export function createGameAccount({gameId, gameTitle, watchAuth, readScores, writeScore, onAccount, onHistory, onStatus,
    now = Date.now, uuid = () => crypto.randomUUID()}) {
    let user = null, generation = 0, readVersion = 0, run = null;
    const pending = new Map(), failed = new Map(), saved = new Set();
    const current = (uid, version) => user?.uid === uid && generation === version;
    const status = (message, error = false) => onStatus?.(message, error, failed.size > 0);
    async function refresh() {
        if (!user) return;
        const uid = user.uid, version = generation, request = ++readVersion;
        status('점수 기록을 불러오는 중…');
        try {
            const rows = (await readScores(uid, gameId)).filter(row => row.gameId === gameId)
                .sort((a,b) => Number(b.playedAt) - Number(a.playedAt));
            if (!current(uid, version) || request !== readVersion) return;
            const best = rows.reduce((max,row) => Math.max(max, Number(row.score) || 0), 0);
            onHistory?.(rows.slice(0, 20), best);
            status(failed.size ? '저장하지 못한 점수가 있습니다. 다시 저장을 눌러 주세요.' : rows.length ? '게임별 최근 점수입니다.' : '첫 점수를 기다리고 있어요.', failed.size > 0);
        } catch {
            if (current(uid, version) && request === readVersion) status('점수 이력을 불러오지 못했습니다. 새로고침으로 다시 시도하세요.', true);
        }
    }
    function persist(item) {
        const {uid, version, id, payload} = item;
        if (!current(uid, version)) return Promise.resolve(false);
        if (saved.has(id)) return Promise.resolve(true);
        if (pending.has(id)) return pending.get(id);
        status('점수를 저장하는 중…');
        const task = Promise.resolve().then(() => writeScore(uid, id, payload)).then(() => {
            if (current(uid, version)) {saved.add(id); failed.delete(id); status('점수를 저장했습니다.'); void refresh();}
            return true;
        }, () => {
            if (current(uid, version)) {failed.set(id, item); status('점수 저장에 실패했습니다. 다시 저장을 눌러 주세요.', true);}
            return false;
        }).finally(() => {if (current(uid, version)) pending.delete(id);});
        pending.set(id, task); return task;
    }
    const unsubscribe = watchAuth(next => {
        if (next?.uid === user?.uid && generation) {user = next; return;}
        user = next || null; generation++; readVersion++; run = null;
        pending.clear(); failed.clear(); saved.clear(); onHistory?.([], 0); onAccount?.(user);
        if (user) void refresh();
    }, () => {user = null; generation++; run = null; onAccount?.(null, true);});
    return {
        canPlay:() => !!user,
        beginRun() {if (!user) return false; run = {uid:user.uid, version:generation, id:`${gameId}_${uuid()}`, finished:false}; return true;},
        finish({score = 0, round = 1, lives = 0, outcome = 'game_over'}) {
            if (!user || !run || !current(run.uid, run.version)) return Promise.resolve(false);
            if (run.finished) return pending.get(run.id) || Promise.resolve(saved.has(run.id));
            run.finished = true;
            const integer = (value, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Math.floor(Number(value)))) : 0;
            return persist({...run, payload:{gameId, gameTitle, runId:run.id, checkpoint:1,
                score:integer(score, 99999999), round:Math.max(1, integer(round, 99999)), lives:integer(lives,999),
                gold:0, energy:0, weaponName:gameId === 'space' ? 'SPACE' : 'SNAKE', weaponRange:1,
                outcome:['game_over','victory','retired','report_return'].includes(outcome) ? outcome : 'game_over',
                playedAt:now()}});
        },
        refresh,
        async retry() {return (await Promise.all([...failed.values()].map(persist))).every(Boolean);},
        async flush() {return (await Promise.all([...pending.values()])).every(Boolean) && failed.size === 0;},
        dispose() {generation++; user = null; unsubscribe?.();}
    };
}
