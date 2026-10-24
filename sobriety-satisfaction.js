const DAY_MS = 86400000;
const KST_MS = 9 * 3600000;
const SCORE_LABELS = ['매우 아쉬워요', '아쉬워요', '보통이에요', '만족해요', '매우 만족해요'];
const SVG_NS = 'http://www.w3.org/2000/svg';

export function satisfactionKoreaDay(at = Date.now()) {
    return Number.isFinite(at) ? new Date(at + KST_MS).toISOString().slice(0, 10) : '';
}

export function normalizeSatisfactionEntries(rows = []) {
    const found = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 160
            || !Number.isInteger(row.score) || row.score < 1 || row.score > 5
            || !Number.isFinite(row.recordedAt) || row.recordedAt <= 0
            || row.recordedAt > 8640000000000000 - KST_MS || found.has(row.id)) continue;
        found.set(row.id, {id:row.id, score:row.score, recordedAt:row.recordedAt, day:satisfactionKoreaDay(row.recordedAt)});
    }
    return [...found.values()].sort((a, b) => a.recordedAt - b.recordedAt || a.id.localeCompare(b.id));
}

export function entriesFromDailyLogs(logs = {}) {
    return normalizeSatisfactionEntries(Object.values(logs || {}).flatMap(log => Array.isArray(log?.sobrietySatisfaction) ? log.sobrietySatisfaction : []));
}

export function filterSatisfactionEntries(rows, period = '30', at = Date.now()) {
    if (!Number.isFinite(at)) return [];
    const days = ['7', '30', '90'].includes(String(period)) ? Number(period) : null;
    const start = days ? (Math.floor((at + KST_MS) / DAY_MS) - days + 1) * DAY_MS - KST_MS : 0;
    return normalizeSatisfactionEntries(rows).filter(row => row.recordedAt >= start && row.recordedAt <= at);
}

function recordedTime(at) {
    const date = new Date(at + KST_MS);
    return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)}`;
}

// Persistence belongs to the signed-in user's private daily logs. This UI does
// not fetch on mount or store health-related scores in browser storage.
export function installSobrietySatisfaction({doc = document, win = window, getUid,
    saveEntry, loadEntries, now = Date.now, newId = () => win.crypto.randomUUID()} = {}) {
    let uid = null, generation = 0, score = 0, busy = false, pending = null, lastSaved = null;
    let message = '', failed = false, entries = [], confirmed = [], historyRun = 0;
    let historyLoading = false, historyError = false, period = '30', visibleCount = 20;
    let dialog = null, historyBody = null, historyTools = null, returnFocus = null, destroyed = false;
    const make = (tag, text, className) => {
        const el = doc.createElement(tag);
        if (text !== undefined) el.textContent = text;
        if (className) el.className = className;
        return el;
    };
    const button = (text, className) => { const el = make('button', text, className); el.type = 'button'; return el; };
    const accountReady = () => !destroyed && !!uid && getUid() === uid;
    const current = (owner, epoch) => accountReady() && uid === owner && generation === epoch;
    const form = make('form', undefined, 'sobriety-satisfaction');
    form.setAttribute('aria-label', '현재 금주 만족도 기록');
    const head = make('div', undefined, 'satisfaction-heading');
    const title = make('strong', '지금 금주 만족도');
    const historyButton = button('그래프로 보기', 'satisfaction-history-button');
    historyButton.setAttribute('aria-haspopup', 'dialog');
    historyButton.setAttribute('aria-controls', 'sobrietySatisfactionDialog');
    head.append(title, historyButton);
    const fieldset = make('fieldset', undefined, 'satisfaction-stars');
    fieldset.append(make('legend', '금주 만족도 · 별 1개부터 5개까지 선택', 'satisfaction-sr-only'));
    const radios = [];
    for (let value = 1; value <= 5; value++) {
        const label = make('label', undefined, 'satisfaction-star');
        const input = make('input'); input.type = 'radio'; input.name = 'sobriety-satisfaction-score'; input.value = String(value);
        input.setAttribute('aria-label', `${value}점 · ${SCORE_LABELS[value - 1]}`);
        const star = make('span', '★'); star.setAttribute('aria-hidden', 'true');
        label.title = `${value}점 · ${SCORE_LABELS[value - 1]}`;
        label.append(input, star); fieldset.append(label); radios.push(input);
        input.addEventListener('change', () => {
            if (!accountReady() || busy) return;
            if (score !== value) pending = null;
            score = value; message = ''; failed = false; renderForm();
        });
    }
    const actionRow = make('div', undefined, 'satisfaction-actions');
    const valueText = make('span', '별을 선택해 주세요', 'satisfaction-value');
    const saveButton = button('기록하기', 'satisfaction-save'); saveButton.type = 'submit';
    actionRow.append(valueText, saveButton);
    const latest = make('p', undefined, 'satisfaction-latest'); latest.hidden = true;
    const status = make('p', undefined, 'satisfaction-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    form.append(head, fieldset, actionRow, latest, status);
    // This form may be remounted after the clock changes; retain the same DOM
    // nodes so keyboard focus, selection and in-flight save controls survive.
    function renderForm() {
        const ready = accountReady();
        fieldset.disabled = !ready || busy;
        saveButton.disabled = !ready || !score || busy;
        saveButton.textContent = busy ? '기록 중…' : failed && pending ? '다시 기록하기' : '기록하기';
        historyButton.disabled = !ready;
        for (const input of radios) {
            const value = Number(input.value);
            input.checked = value === score;
            input.parentElement.classList.toggle('is-filled', value <= score);
        }
        valueText.textContent = score ? `${score}점 · ${SCORE_LABELS[score - 1]}` : '별을 선택해 주세요';
        latest.hidden = !lastSaved;
        latest.textContent = lastSaved ? `최근 기록 ${recordedTime(lastSaved.recordedAt)} · ${lastSaved.score}/5점` : '';
        status.textContent = message || (ready ? '지금의 느낌을 남겨 주세요. 하루에 여러 번 기록할 수 있어요.' : '로그인 후 만족도를 기록할 수 있어요.');
        status.classList.toggle('is-error', failed);
        form.setAttribute('aria-busy', String(busy));
    }
    async function save(event) {
        event.preventDefault();
        if (!accountReady() || busy || !Number.isInteger(score) || score < 1 || score > 5) return;
        const owner = uid, epoch = generation;
        busy = true; failed = false; message = '만족도를 기록하고 있어요…'; renderForm();
        try {
            if (!pending) {
                const recordedAt = now();
                pending = normalizeSatisfactionEntries([{id:newId(), score, recordedAt}])[0];
                if (!pending) throw new Error('Invalid satisfaction record');
            }
            const entry = pending;
            await saveEntry(owner, entry);
            if (!current(owner, epoch)) return;
            confirmed = normalizeSatisfactionEntries([...confirmed, entry]);
            entries = normalizeSatisfactionEntries([...entries, entry]);
            lastSaved = entry; score = 0; pending = null;
            message = `${entry.score}점으로 기록했어요. 다음 느낌도 새로 남길 수 있어요.`;
            if (dialog?.open) renderHistory();
        } catch {
            if (!current(owner, epoch)) return;
            failed = true;
            message = '기록을 저장하지 못했어요. 연결과 로그인 상태를 확인하고 다시 눌러 주세요.';
        } finally {
            if (current(owner, epoch)) { busy = false; renderForm(); }
        }
    }
    form.addEventListener('submit', save);
    historyButton.addEventListener('click', openHistory);

    function resetDraft() {
        if (busy) return;
        score = 0; pending = null; failed = false; message = ''; renderForm();
    }
    function mount(host) {
        if (!host || destroyed) return;
        if (form.parentElement !== host) host.replaceChildren(form);
        renderForm();
    }
    function bindAccount(nextUid) {
        nextUid = typeof nextUid === 'string' && nextUid ? nextUid : null;
        if (uid === nextUid) { renderForm(); return; }
        generation++; historyRun++; uid = nextUid;
        busy = false; score = 0; pending = null; lastSaved = null; message = ''; failed = false;
        entries = []; confirmed = []; historyLoading = false; historyError = false; period = '30'; visibleCount = 20;
        historyBody?.replaceChildren();
        historyBody?.setAttribute('aria-busy', 'false');
        closeHistory(); renderForm();
    }

    function closeHistory() {
        historyRun++;
        if (!dialog?.open) return;
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
        if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
        returnFocus = null;
    }
    function ensureDialog() {
        if (dialog) return;
        dialog = make('dialog', undefined, 'satisfaction-dialog'); dialog.id = 'sobrietySatisfactionDialog';
        dialog.setAttribute('aria-labelledby', 'sobrietySatisfactionTitle');
        const header = make('div', undefined, 'satisfaction-dialog-heading');
        const heading = make('h2', '금주 만족도 그래프'); heading.id = 'sobrietySatisfactionTitle';
        const close = button('닫기', 'satisfaction-close'); close.addEventListener('click', closeHistory); header.append(heading, close);
        const note = make('p', '매번 남긴 별점을 기록 시각순으로 연결합니다. 점을 누르면 그때의 점수와 시각을 볼 수 있어요.', 'satisfaction-description');
        historyTools = make('div', undefined, 'satisfaction-periods'); historyTools.setAttribute('role', 'group'); historyTools.setAttribute('aria-label', '만족도 그래프 표시 기간');
        for (const [key, label] of [['7', '7일'], ['30', '30일'], ['90', '90일'], ['all', '전체']]) {
            const item = button(label); item.dataset.satisfactionPeriod = key;
            item.addEventListener('click', () => { period = key; visibleCount = 20; renderHistory(); }); historyTools.append(item);
        }
        historyBody = make('div', undefined, 'satisfaction-history-body'); historyBody.setAttribute('aria-live', 'polite');
        dialog.append(header, note, historyTools, historyBody); doc.body.append(dialog);
        dialog.addEventListener('cancel', event => { event.preventDefault(); closeHistory(); });
        dialog.addEventListener('click', event => {
            const rect = dialog.getBoundingClientRect();
            if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeHistory();
        });
    }
    async function reloadHistory() {
        if (!accountReady() || !dialog?.open) return;
        const owner = uid, epoch = generation, request = ++historyRun;
        historyLoading = true; historyError = false; renderHistory();
        try {
            const rows = await loadEntries(owner);
            if (!current(owner, epoch) || request !== historyRun || !dialog.open) return;
            entries = normalizeSatisfactionEntries([...rows, ...confirmed]);
            if (entries.length) lastSaved = entries.at(-1);
            historyLoading = false; renderForm(); renderHistory();
        } catch {
            if (!current(owner, epoch) || request !== historyRun || !dialog.open) return;
            historyLoading = false; historyError = true; renderHistory();
        }
    }
    function openHistory() {
        if (!accountReady()) return;
        ensureDialog();
        if (!dialog.open) {
            returnFocus = doc.activeElement;
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
            dialog.querySelector('.satisfaction-close').focus();
        }
        visibleCount = 20;
        void reloadHistory();
    }
    function renderHistory() {
        if (!historyBody) return;
        historyTools.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.satisfactionPeriod === period)));
        historyBody.replaceChildren();
        historyBody.setAttribute('aria-busy', String(historyLoading));
        if (historyLoading) { historyBody.append(make('p', '만족도 기록을 불러오고 있어요…', 'satisfaction-empty')); return; }
        if (historyError) {
            historyBody.append(make('p', '기록을 불러오지 못했어요. 연결과 로그인 상태를 확인해 주세요.', 'satisfaction-empty is-error'));
            const retry = button('다시 불러오기', 'satisfaction-retry'); retry.addEventListener('click', reloadHistory); historyBody.append(retry); return;
        }
        const rows = filterSatisfactionEntries(entries, period, now());
        if (!rows.length) {
            historyBody.append(make('p', entries.length ? '선택한 기간에 기록한 만족도가 없어요. 전체 기간을 확인해 보세요.' : '아직 만족도 기록이 없어요. 별을 선택하고 기록하기를 눌러 주세요.', 'satisfaction-empty'));
            return;
        }
        const average = rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
        const stats = make('p', undefined, 'satisfaction-chart-summary');
        stats.append(make('strong', `${average.toFixed(2)} / 5`), make('span', `기록 ${rows.length}회 평균 · 최근 ${rows.at(-1).score}점`));
        historyBody.append(stats);
        const svg = doc.createElementNS(SVG_NS, 'svg'); svg.setAttribute('viewBox', '0 0 440 228'); svg.classList.add('satisfaction-chart');
        svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', `금주 만족도 1점부터 5점까지의 추이. ${rows.length}회 기록, 평균 ${average.toFixed(2)}점. 아래에서 시각별 기록을 확인할 수 있습니다.`);
        const svgNode = (tag, attrs, text) => {
            const el = doc.createElementNS(SVG_NS, tag);
            for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
            if (text !== undefined) el.textContent = text;
            return el;
        };
        const left = 34, right = 422, top = 20, bottom = 188;
        const first = rows[0].recordedAt, last = rows.at(-1).recordedAt;
        const x = at => last === first ? (left + right) / 2 : left + (at - first) / (last - first) * (right - left);
        const y = value => bottom - (value - 1) / 4 * (bottom - top);
        for (let value = 1; value <= 5; value++) {
            svg.append(svgNode('line', {x1:left, x2:right, y1:y(value), y2:y(value), class:'satisfaction-chart-grid'}));
            svg.append(svgNode('text', {x:left - 10, y:y(value) + 4, 'text-anchor':'end', class:'satisfaction-chart-axis'}, `${value}`));
        }
        if (rows.length > 1) svg.append(svgNode('polyline', {points:rows.map(row => `${x(row.recordedAt)},${y(row.score)}`).join(' '), fill:'none', class:'satisfaction-chart-line'}));
        const selectedText = make('p', '시각별 개별 기록 · 한국 시간 기준', 'satisfaction-selected'); selectedText.setAttribute('role', 'status');
        rows.forEach(row => {
            const dot = svgNode('circle', {cx:x(row.recordedAt), cy:y(row.score), r:4.5, class:'satisfaction-chart-point', tabindex:0, role:'button', 'aria-label':`${recordedTime(row.recordedAt)}, ${row.score}점`});
            dot.append(svgNode('title', {}, `${recordedTime(row.recordedAt)} · ${row.score}/5점`));
            const select = () => { selectedText.textContent = `${recordedTime(row.recordedAt)} · ${row.score}/5점 · ${SCORE_LABELS[row.score - 1]}`; };
            dot.addEventListener('click', select); dot.addEventListener('focus', select);
            dot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
            svg.append(dot);
        });
        if (first === last) svg.append(svgNode('text', {x:(left + right) / 2, y:214, 'text-anchor':'middle', class:'satisfaction-chart-axis'}, recordedTime(first).slice(5, 16)));
        else {
            svg.append(svgNode('text', {x:left, y:214, 'text-anchor':'start', class:'satisfaction-chart-axis'}, recordedTime(first).slice(5, 16)));
            svg.append(svgNode('text', {x:right, y:214, 'text-anchor':'end', class:'satisfaction-chart-axis'}, recordedTime(last).slice(5, 16)));
        }
        historyBody.append(svg, selectedText);
        const table = make('table', undefined, 'satisfaction-history-table');
        table.append(make('caption', '시각별 만족도 · 최신순'));
        const thead = make('thead'), headings = make('tr');
        for (const label of ['기록 시각', '만족도']) { const th = make('th', label); th.scope = 'col'; headings.append(th); }
        thead.append(headings); table.append(thead);
        const tbody = make('tbody');
        for (const row of rows.slice().reverse().slice(0, visibleCount)) {
            const tr = make('tr'), at = make('td'), value = make('td');
            const time = make('time', recordedTime(row.recordedAt)); time.dateTime = new Date(row.recordedAt).toISOString(); at.append(time);
            const stars = make('span', '★'.repeat(row.score) + '☆'.repeat(5 - row.score), 'satisfaction-history-stars'); stars.setAttribute('aria-hidden', 'true');
            value.append(stars, make('span', `${row.score}/5점`)); tr.append(at, value); tbody.append(tr);
        }
        table.append(tbody); historyBody.append(table);
        if (rows.length > visibleCount) {
            const more = button(`기록 더 보기 (${visibleCount}/${rows.length})`, 'satisfaction-more');
            more.addEventListener('click', () => { visibleCount += 20; renderHistory(); }); historyBody.append(more);
        }
    }
    const onVisible = () => { if (doc.visibilityState === 'visible') resetDraft(); };
    const onPageShow = () => resetDraft();
    doc.addEventListener('visibilitychange', onVisible);
    win.addEventListener('pageshow', onPageShow);
    renderForm();
    return {mount, bindAccount, resetDraft, openHistory,
        destroy() {
            generation++; historyRun++; destroyed = true;
            closeHistory(); dialog?.remove(); form.remove();
            doc.removeEventListener('visibilitychange', onVisible); win.removeEventListener('pageshow', onPageShow);
        }
    };
}
