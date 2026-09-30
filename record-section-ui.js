const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_BADGE_MS = 7 * DAY_MS;

// Feature release dates, not record activity or the visitor's first visit.
// Change only the affected section's date when its features are updated.
export const SECTION_FEATURE_UPDATES = Object.freeze({
    activeRecoverySummary: '2026-09-28T23:21:30+09:00',
    sectionCraving: '2026-10-01T07:53:11+09:00',
    sectionStats: '2026-09-28T23:21:30+09:00',
    sectionRecovery: '2026-09-30T07:19:11+09:00'
});

export function isRecentSectionUpdate(updatedAt, nowMs = Date.now()) {
    const age = nowMs - Date.parse(updatedAt);
    return Number.isFinite(age) && age >= 0 && age < NEW_BADGE_MS;
}

export function dayProgress(elapsedMs, now = new Date()) {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) % DAY_MS : 0;
    const today = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return { elapsed: elapsed / DAY_MS * 100, today: today / 86400 * 100 };
}

export function installRecordSectionUI({
    document: doc = document, window: win = window,
    updates = SECTION_FEATURE_UPDATES, now = Date.now
} = {}) {
    const viewport = doc.getElementById('diagnosisActiveNames');
    const primary = doc.getElementById('diagnosisActiveNamesText');
    const repeat = doc.getElementById('diagnosisActiveNamesRepeat');
    const track = doc.getElementById('diagnosisActiveNamesTrack');
    let frame = null, expiryTimer = null, currentNames = null;

    function measureNames() {
        frame = null;
        if (!viewport || !primary || !repeat || !track) return;
        const available = viewport.clientWidth;
        const width = primary.scrollWidth;
        const overflow = !!currentNames && available > 0 && width > available + 1;
        viewport.classList.toggle('is-overflowing', overflow);
        repeat.hidden = !overflow;
        if (overflow) {
            const distance = width + 24;
            track.style.setProperty('--diagnosis-scroll-distance', `${distance}px`);
            track.style.setProperty('--diagnosis-scroll-duration', `${Math.max(10, distance / 25)}s`);
        }
    }
    function requestMeasure() {
        if (frame === null) frame = win.requestAnimationFrame(measureNames);
    }
    function setDiagnosisNames(names, emptyText = '회복 중인 질환 없음') {
        if (!viewport || !primary || !repeat) return;
        const text = [...new Set(names.map(name => String(name ?? '').trim()).filter(Boolean))].join(', ');
        const shown = text || emptyText;
        if (currentNames === text && primary.textContent === shown) return;
        currentNames = text;
        primary.textContent = shown;
        repeat.textContent = text;
        viewport.title = text ? `회복 중인 질환: ${text}` : emptyText;
        viewport.classList.toggle('is-empty', !text);
        // Reset the old animation immediately when account/diagnosis data changes.
        viewport.classList.remove('is-overflowing');
        repeat.hidden = true;
        requestMeasure();
    }

    function refreshFeatureBadges() {
        if (expiryTimer !== null) win.clearTimeout(expiryTimer);
        expiryTimer = null;
        const nowMs = now();
        let nextChange = Infinity;
        for (const badge of doc.querySelectorAll('[data-section-new]')) {
            const updatedAt = updates[badge.dataset.sectionNew];
            const start = Date.parse(updatedAt);
            const recent = isRecentSectionUpdate(updatedAt, nowMs);
            badge.hidden = !recent;
            if (recent) {
                badge.title = `${new Date(start).toLocaleDateString('ko-KR')} 기능 업데이트 · 7일간 표시`;
                nextChange = Math.min(nextChange, start + NEW_BADGE_MS);
            } else if (Number.isFinite(start) && start > nowMs) {
                nextChange = Math.min(nextChange, start);
            }
        }
        if (Number.isFinite(nextChange)) {
            expiryTimer = win.setTimeout(refreshFeatureBadges, Math.min(2147483647, Math.max(1, nextChange - nowMs)));
        }
    }

    function updateDayProgress(elapsedMs, time = new Date()) {
        const progress = dayProgress(elapsedMs, time);
        const elapsed = doc.getElementById('subTimePercent');
        const today = doc.getElementById('subDayPercent');
        if (elapsed) {
            elapsed.textContent = `(${progress.elapsed.toFixed(1)}%)`;
            elapsed.setAttribute('aria-label', `도전 24시간 주기 진행률 ${elapsed.textContent}`);
        }
        if (today) {
            today.textContent = `(${progress.today.toFixed(1)}%)`;
            today.setAttribute('aria-label', `오늘의 24시간 진행률 ${today.textContent}`);
        }
    }

    const resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(requestMeasure) : null;
    if (viewport) resizeObserver?.observe(viewport);
    win.addEventListener('resize', requestMeasure);
    doc.addEventListener('visibilitychange', () => {
        if (!doc.hidden) { requestMeasure(); refreshFeatureBadges(); }
    });
    doc.addEventListener('app:tabchange', requestMeasure);
    doc.fonts?.ready.then(requestMeasure);
    setDiagnosisNames([]);
    refreshFeatureBadges();
    return {setDiagnosisNames, refreshFeatureBadges, updateDayProgress};
}
