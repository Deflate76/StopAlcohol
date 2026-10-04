// Korean public-holiday rules reviewed 2026-10-04 (including Labor/Constitution Day).
// https://www.mpm.go.kr/mpm/info/infoService/BizService02/
// https://www.law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=172595
// One-off holidays must be updated when the government announces additional dates.
const DAY_MS = 86400000;
const cache = new Map();
const SPECIAL_HOLIDAYS = Object.freeze({
    '2014-06-04':'지방선거', '2015-08-14':'임시공휴일',
    '2016-04-13':'국회의원선거', '2016-05-06':'임시공휴일',
    '2017-05-09':'대통령선거', '2017-10-02':'임시공휴일', '2018-06-13':'지방선거',
    '2020-04-15':'국회의원선거', '2020-08-17':'임시공휴일',
    '2022-03-09':'대통령선거', '2022-06-01':'지방선거', '2023-10-02':'임시공휴일',
    '2024-04-10':'국회의원선거', '2024-10-01':'국군의 날',
    '2025-01-27':'임시공휴일', '2025-06-03':'대통령선거', '2026-06-03':'지방선거'
});

export function koreanDateKey(time = Date.now()) {
    return new Date(Number(time) + 9 * 3600000).toISOString().slice(0, 10);
}
export function shiftCalendarDate(key, days) {
    return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
const weekday = key => new Date(`${key}T12:00:00Z`).getUTCDay();

export function getKoreanHolidays(year) {
    if (cache.has(year)) return cache.get(year);
    const dates = new Map();
    const supported = Number.isInteger(year) && year >= 2014 && year <= 2100;
    if (!supported) return {dates, supported, lunarSupported:false};
    const add = (key, name, substitute = 'none', regular = true) => {
        const entries = dates.get(key) || [];
        entries.push({name, substitute, regular}); dates.set(key, entries);
    };
    const nationalRule = key => key >= '2021-08-04' ? 'weekend' : 'none';
    for (const [md, name] of [['01-01','신정'],['03-01','삼일절'],['05-05','어린이날'],
        ['06-06','현충일'],['08-15','광복절'],['10-03','개천절'],['10-09','한글날'],['12-25','성탄절']]) {
        const key = `${year}-${md}`;
        const rule = md === '05-05' ? 'weekend' : md === '12-25' ? (year >= 2023 ? 'weekend' : 'none') :
            ['03-01','08-15','10-03','10-09'].includes(md) ? nationalRule(key) : 'none';
        add(key, name, rule);
    }
    if (year >= 2026) { add(`${year}-05-01`, '노동절', 'weekend'); add(`${year}-07-17`, '제헌절', 'weekend'); }

    let lunarSupported = false;
    try {
        // Dangi uses the Korean lunisolar calendar; ignore leap months (e.g. "6bis").
        const lunar = new Intl.DateTimeFormat('en-US-u-ca-dangi', {timeZone:'Asia/Seoul',month:'numeric',day:'numeric'});
        lunarSupported = lunar.resolvedOptions().calendar === 'dangi';
        if (lunarSupported) for (let key = `${year}-01-01`; key < `${year+1}-01-01`; key = shiftCalendarDate(key, 1)) {
            const parts = Object.fromEntries(lunar.formatToParts(new Date(`${key}T12:00:00+09:00`)).map(p => [p.type,p.value]));
            if (!/^\d+$/.test(parts.month)) continue;
            const month = Number(parts.month), day = Number(parts.day);
            if (month === 1 && day === 1 || month === 8 && day === 15) {
                const name = month === 1 ? '설날' : '추석';
                for (const delta of [-1,0,1]) add(shiftCalendarDate(key, delta), delta === 0 ? name : `${name} 연휴`, 'sunday');
            }
            if (month === 4 && day === 8) add(key, '부처님오신날', year >= 2023 ? 'weekend' : 'none');
        }
    } catch { lunarSupported = false; }

    for (const [key,name] of Object.entries(SPECIAL_HOLIDAYS)) if (key.startsWith(`${year}-`)) add(key,name,'none',false);
    // One overlapping calendar day creates one replacement (Children's/Buddha Day 2025).
    // Distinct original dates whose replacements collide move to successive free weekdays.
    const originals = [...dates].sort(([a],[b]) => a.localeCompare(b));
    for (const [key, entries] of originals) {
        const dow = weekday(key), regular = entries.filter(e => e.regular);
        const eligible = regular.filter(e => e.substitute !== 'none');
        const overlaps = dow !== 0 && dow !== 6 && regular.length > 1 && eligible.length > 0;
        const weekend = eligible.some(e => dow === 0 || dow === 6 && e.substitute === 'weekend');
        if (!overlaps && !weekend) continue;
        let replacement = shiftCalendarDate(key,1);
        while (dates.has(replacement) || [0,6].includes(weekday(replacement))) replacement = shiftCalendarDate(replacement,1);
        add(replacement, `대체공휴일 (${[...new Set(eligible.map(e => e.name.replace(' 연휴','')))].join('·')})`, 'none', false);
    }
    const result = {dates, supported, lunarSupported};
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(year, result);
    return result;
}
