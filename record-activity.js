const DAY_MS = 86400000;
const KST_OFFSET = 9 * 3600000;

export function recordTimeMs(value) {
    if (value == null || value === '') return NaN;
    if (value instanceof Date) return value.getTime();
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
    return typeof value === 'number' ? value : Date.parse(value);
}

export function koreaDayKey(value = Date.now()) {
    const ms = recordTimeMs(value);
    return Number.isFinite(ms) ? new Date(ms + KST_OFFSET).toISOString().slice(0, 10) : '';
}

export function nextKoreaMidnight(nowMs = Date.now()) {
    return (Math.floor((nowMs + KST_OFFSET) / DAY_MS) + 1) * DAY_MS - KST_OFFSET;
}

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const present = value => value !== null && value !== undefined && value !== '';
const stateLabels = {withdrawal:'금단', mood:'기분', thirst:'갈증', fatigue:'피로', stress:'스트레스', sleep:'수면', hunger:'허기', brainFog:'브레인포그'};
const dailyLabels = {breakfast:'아침', lunch:'점심', dinner:'저녁', snack:'간식', alcohol:'음주량', blackout:'블랙아웃', smoking:'흡연량'};

// Only persisted activity is supplied here. Unsaved form defaults never appear.
// "Today" follows the entry/save time, including a backdated measurement saved today.
export function summarizeTodayActivity(data = {}, nowMs = Date.now()) {
    const day = koreaDayKey(nowMs), entries = [], seen = new Set();
    const today = value => {
        const ms = recordTimeMs(value);
        return ms <= nowMs && koreaDayKey(ms) === day;
    };
    function add(category, text, timestamp) {
        text = clean(text);
        if (!text || !today(timestamp)) return;
        const key = JSON.stringify([category, text, recordTimeMs(timestamp)]);
        if (seen.has(key)) return;
        seen.add(key); entries.push({category, text, timestamp:recordTimeMs(timestamp)});
    }
    const cravings = (data.challenges || []).filter(c => c.id !== data.currentId).flatMap(c => c.cravings || [])
        .concat(data.cravings || []);
    for (const e of cravings) {
        if (!e || typeof e !== 'object') continue;
        const at = e.recordedAt ?? e.timestamp;
        if (e.type === 'state') {
            const values = Object.entries(stateLabels).filter(([key]) => present(e[key])).map(([key,label]) => `${label} ${e[key]}/10`);
            if (values.length) add('state', `몸상태: ${values.join(', ')}`, at);
        } else if (e.type === 'action') add('action', `대처: ${clean(e.actionName)}${e.actionDesc ? ' · ' + clean(e.actionDesc) : ''}`, at);
        else if (e.type === 'eval') add('action', `대처 평가: 효과 ${e.effect}/10 · 갈망 ${e.strength}/10`, at);
        else if (e.type === 'medication') add('medication', `복용: ${clean(e.drugName)} ${clean(e.dose)}mg`, at);
        else add('craving', `갈망 ${present(e.strength) ? e.strength + '/10' : ''}${e.reason ? ' · ' + clean(e.reason) : ''}`, at);
    }
    for (const e of data.bodyLogs || []) {
        const values = [];
        if (present(e.weight)) values.push(`${e.weight}kg`);
        if (present(e.height)) values.push(`${e.height}cm`);
        if (values.length) add('body', `신체계측: ${values.join(' · ')}`, e.recordedAt ?? e.measuredAt);
    }
    for (const [date, log] of Object.entries(data.dailyLogs || {})) {
        const at = key => log.fieldRecordedAt ? log.fieldRecordedAt[key] : log.updatedAt;
        const values = Object.entries(dailyLabels).filter(([key]) => present(log[key]) && today(at(key))
            // Legacy forms saved zero for untouched sliders. Do not invent activity.
            && (log.fieldRecordedAt || Number(log[key]) > 0));
        for (const [key,label] of values) add(key === 'smoking' ? 'smoking' : 'daily', `${date === day ? '' : date + ' '}${label} ${log[key]}/10`, at(key));
        if (present(log.weight) && today(at('weight')) && !entries.some(e => e.category === 'body')) {
            add('body', `체중 ${log.weight}kg`, at('weight'));
        }
        for (const [key,label] of [['alcoholCost','음주 비용'],['alcoholTime','음주 시간']]) {
            if (present(log[key]) && log[key + 'Label']) add('daily', `${label}: ${clean(log[key + 'Label'])}`, at(key));
        }
    }
    for (const c of data.challenges || []) {
        add('history', `단주 기록 추가${c.startReason ? ' · ' + clean(c.startReason) : ''}${c.failReason ? ' · 종료 사유: ' + clean(c.failReason) : ''}`, c.createdAt);
    }
    for (const session of data.controlSessions || []) {
        add('control', `음주 조절: ${Array.isArray(session.drinksList) ? session.drinksList.length : 0}잔 기록`, session.updatedAt ?? session.endTime ?? session.startTime);
    }
    for (const e of data.cautions || []) add('caution', `요주의 ${clean(e.date)} · ${clean(e.reason)}`, e.timestamp);
    for (const e of data.healthEntries || []) {
        const values = [];
        if (clean(e.note)) values.push(clean(e.note));
        if (present(e.condition)) values.push(`컨디션 ${e.condition}/10`);
        if (present(e.stress)) values.push(`스트레스 ${e.stress}/10`);
        for (const d of Array.isArray(e.diagnoses) ? e.diagnoses : []) if (clean(d.name)) values.push(`진단 ${clean(d.name)}`);
        if (values.length) add('health', `건강기록: ${values.join(' · ')}`, e.updatedAt ?? e.createdAt ?? e.createdAtClient);
    }
    entries.sort((a,b) => b.timestamp - a.timestamp);
    return {entries, categories:new Set(entries.map(e => e.category)), text:entries.map(e => e.text).join('  ·  ')};
}

export function formatRecordDuration(ms) {
    const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    return `${Math.floor(seconds / 86400)}일 ${Math.floor(seconds / 3600) % 24}시간 ${Math.floor(seconds / 60) % 60}분 ${seconds % 60}초`;
}

export function compareStreakRecords(rows, nowMs = Date.now()) {
    const current = rows.find(row => row.isCurrent);
    const previous = current && rows.find(row => row.ordinal === current.ordinal - 1);
    if (!current || !previous || !Number.isFinite(previous.durationMs)) return null;
    const duration = current.isActive ? Math.max(0, nowMs - current.startMs) : current.durationMs;
    if (!Number.isFinite(duration)) return null;
    const difference = duration - previous.durationMs;
    return {previous, current, difference,
        differenceText: difference === 0 ? '앞선 기록과 같은 유지기간' : `앞선 기록보다 ${formatRecordDuration(Math.abs(difference))} ${difference < 0 ? '짧음' : '더 유지'}`,
        gapMs: Number.isFinite(previous.endMs) && current.startMs >= previous.endMs ? current.startMs - previous.endMs : null};
}
