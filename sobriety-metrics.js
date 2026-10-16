const DAY = 86400000;
// Calendar days are Korean dates even when the device is used abroad.
export function koreanDay(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const ms = Date.parse(value + 'T00:00:00Z');
        return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY : null;
    }
    const ms = value?.toMillis ? value.toMillis() : value instanceof Date ? value.getTime()
        : typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(ms) ? Math.floor((ms + 9 * 3600000) / DAY) : null;
}

export function calculateSobrietyRate({createdAt, challenges = [], dailyLogs = {}, controlSessions = [], now = Date.now()}) {
    const created = koreanDay(createdAt), today = koreanDay(now);
    const empty = {startDate:null, totalDays:0, drinkingDays:0, soberDays:0, percent:null};
    if (created === null || today === null) return empty;
    const starts = challenges.map(c => koreanDay(c.startDate)).filter(day => day !== null && day >= created && day <= today);
    if (!starts.length) return empty;
    const first = Math.min(...starts), drinks = new Set();
    const add = value => {const day = koreanDay(value); if (day !== null && day >= first && day <= today) drinks.add(day);};
    for (const [date, log] of Object.entries(dailyLogs)) if (Number(log?.alcohol) > 0) add(date);
    // A failed status alone can also mean switching attempts, not drinking.
    for (const c of challenges) {
        if (c.status === 'failed' && c.hasRecordedEndDate !== false && Number(c.failAmount) > 0) add(c.endDate);
    }
    for (const session of controlSessions) {
        const drinks = Array.isArray(session.drinksList) ? session.drinksList : [];
        for (const drink of drinks) if ((Number(drink.alcoholGrams) > 0 || (Number(drink.abv) > 0 && Number(drink.volume) > 0))) add(drink.drinkStartedAt ?? drink.endTime ?? drink.startTime ?? session.startTime);
        if (!drinks.length && Number(session.totalAlcoholGrams) > 0) add(session.startTime);
    }
    const totalDays = today - first + 1, soberDays = totalDays - drinks.size;
    return {startDate:new Date(first * DAY).toISOString().slice(0, 10), totalDays,
        drinkingDays:drinks.size, soberDays, percent:Math.round(soberDays / totalDays * 100)};
}

export function previousBestDays(challenges, currentId, currentStart) {
    const start = new Date(currentStart).getTime();
    if (!Number.isFinite(start) || currentStart == null) return null;
    let best = 0;
    for (const c of challenges || []) {
        if (c.id === currentId || c.status === 'active' || c.hasRecordedEndDate === false || !c.endDate || !c.startDate) continue;
        const from = new Date(c.startDate).getTime(), to = new Date(c.endDate).getTime();
        if (Number.isFinite(from) && Number.isFinite(to) && to <= start && to > from) best = Math.max(best, to - from);
    }
    return best > 0 ? best / DAY : null;
}
