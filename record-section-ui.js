import { summarizeTodayActivity, nextKoreaMidnight } from './record-activity.js?v=20261005-1';
const DAY_MS = 86400000;

export function dayProgress(elapsedMs, now = new Date()) {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) % DAY_MS : 0;
    const today = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return { elapsed: elapsed / DAY_MS * 100, today: today / 86400 * 100 };
}

export function installRecordSectionUI({document: doc = document, window: win = window, now = Date.now} = {}) {
    const previews = new Map();
    let frame = null, expiryTimer = null, activityData = {};
    function measureNames() {
        frame = null;
        for (const [id, state] of previews) {
            const {viewport, primary, repeat, track, text} = state;
            if (!viewport.isConnected) { resizeObserver?.unobserve(viewport); previews.delete(id); continue; }
            const available = viewport.clientWidth, width = primary.scrollWidth;
            const overflow = !!text && available > 0 && width > available + 1;
            viewport.classList.toggle('is-overflowing', overflow);
            repeat.hidden = !overflow;
            if (overflow) {
                const distance = width + 24;
                track.style.setProperty('--diagnosis-scroll-distance', `${distance}px`);
                track.style.setProperty('--diagnosis-scroll-duration', `${Math.max(10, distance / 25)}s`);
            }
        }
    }
    function requestMeasure() {
        if (frame === null) frame = win.requestAnimationFrame(measureNames);
    }
    function setSummary(id, text, emptyText = '') {
        const viewport = doc.getElementById(id);
        const track = viewport?.querySelector('.diagnosis-summary-track');
        const [primary, repeat] = track?.children || [];
        if (!viewport || !primary || !repeat) return;
        text = String(text ?? '').replace(/\s+/g, ' ').trim();
        const shown = text || emptyText, old = previews.get(id);
        if (old?.viewport === viewport && old.text === text && primary.textContent === shown) return;
        if (old && old.viewport !== viewport) resizeObserver?.unobserve(old.viewport);
        previews.set(id, {viewport, track, primary, repeat, text});
        primary.textContent = shown;
        repeat.textContent = text;
        viewport.title = shown;
        viewport.classList.toggle('is-empty', !text);
        viewport.classList.remove('is-overflowing');
        repeat.hidden = true;
        resizeObserver?.observe(viewport);
        requestMeasure();
    }
    function setDiagnosisNames(names, emptyText = '회복 중인 질환 없음') {
        setSummary('diagnosisActiveNames', [...new Set(names.map(name => String(name ?? '').trim()).filter(Boolean))].join(', '), emptyText);
    }
    function refreshActivity() {
        const activity = summarizeTodayActivity(activityData, now());
        setSummary('sectionCravingPreview', activity.text, '오늘 입력한 기록 없음');
        for (const button of doc.querySelectorAll('[data-activity-categories]')) {
            let badge = button.querySelector('.record-new-badge');
            if (!badge) {
                badge = doc.createElement('span'); badge.className = 'section-new-badge record-new-badge';
                badge.textContent = 'NEW'; badge.title = '오늘 입력한 기록이 있습니다';
                badge.setAttribute('aria-label', '오늘 입력한 기록'); button.append(badge);
            }
            badge.hidden = !button.dataset.activityCategories.split(' ').some(key => activity.categories.has(key));
        }
        if (expiryTimer !== null) win.clearTimeout(expiryTimer);
        expiryTimer = win.setTimeout(refreshActivity, Math.max(1, nextKoreaMidnight(now()) - now()));
    }
    function setActivityData(data = {}) { activityData = data; refreshActivity(); }
    function updateDayProgress(elapsedMs, time = new Date()) {
        const progress = dayProgress(elapsedMs, time);
        for (const [id, value, label] of [['subTimePercent', progress.elapsed, '도전 24시간 주기 진행률'], ['subDayPercent', progress.today, '오늘의 24시간 진행률']]) {
            const el = doc.getElementById(id);
            if (el) { el.textContent = `(${value.toFixed(1)}%)`; el.setAttribute('aria-label', `${label} ${el.textContent}`); }
        }
    }
    const resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(requestMeasure) : null;
    win.addEventListener('resize', requestMeasure);
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) { requestMeasure(); refreshActivity(); } });
    doc.addEventListener('app:tabchange', requestMeasure);
    doc.addEventListener('toggle', requestMeasure, true);
    doc.fonts?.ready.then(requestMeasure);
    setDiagnosisNames([]);
    refreshActivity();
    return {setDiagnosisNames, setSummary, setActivityData, updateDayProgress};
}
