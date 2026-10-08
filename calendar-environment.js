import SunCalc from './vendor/suncalc-1.9.0.js';
import {WEATHER_REGIONS, weatherDescription} from './daily-health-tools.js?v=20261008-1';
import {afterPaint} from './app-loading.js?v=20261008-1';
import {getKoreanHolidays, koreanDateKey, shiftCalendarDate} from './korean-calendar.js?v=20261004-1';

const CLOCK = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const MOONS = [['🌑','삭'],['🌒','초승달'],['🌓','상현달'],['🌔','차오르는 달'],
    ['🌕','보름달'],['🌖','기우는 달'],['🌗','하현달'],['🌘','그믐달']];
const STORAGE_KEY = 'alcoholaway-weather-region';
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00+09:00`)) && new Date(`${value}T12:00:00+09:00`).toISOString().slice(0,10) === value;

export function calendarAstronomy(dateKey, lat, lon) {
    if (!validDay(dateKey) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    // Noon in Korea fixes both the civil date and the representative daily lunar phase.
    const date = new Date(`${dateKey}T12:00:00+09:00`);
    const times = SunCalc.getTimes(date, lat, lon), moon = SunCalc.getMoonIllumination(date);
    const [icon, label] = MOONS[Math.round(moon.phase * 8) % 8];
    const time = value => Number.isFinite(value.getTime()) ? CLOCK.format(value) : '—';
    return {sunrise:time(times.sunrise), sunset:time(times.sunset), moon:{icon,label,illumination:Math.round(moon.fraction*100)}};
}

export function parseCalendarForecast(data, today) {
    if (data?.utc_offset_seconds !== 32400 || !Array.isArray(data.daily?.time)) throw new Error('Invalid Korean forecast');
    const dates = new Map(), end = shiftCalendarDate(today,15);
    data.daily.time.slice(0,16).forEach((date, index) => {
        if (!validDay(date) || date < today || date > end) return;
        const code = data.daily.weather_code?.[index], min = data.daily.temperature_2m_min?.[index], max = data.daily.temperature_2m_max?.[index];
        const description = weatherDescription(code);
        const validTemperature = Number.isFinite(min) && Number.isFinite(max) && min <= max && min >= -100 && max <= 70;
        const validCode = description !== '기상상황 미확인';
        if (!validTemperature && !validCode) return;
        dates.set(date, {description, icon:validCode ? description.split(' ')[0] : '—',
            min:validTemperature ? min : null, max:validTemperature ? max : null});
    });
    if (!dates.size) throw new Error('Empty forecast');
    return dates;
}

export function installCalendarEnvironment({document:doc = globalThis.document, window:win = globalThis.window,
    fetch = (...args) => win.fetch(...args), now = Date.now} = {}) {
    const grid = doc.getElementById('calendarDaysGrid'), select = doc.getElementById('calEnvironmentRegion');
    if (!grid || !select) return {render() {}};
    const status = doc.getElementById('calEnvironmentStatus'), retry = doc.getElementById('calEnvironmentRefresh');
    const note = doc.getElementById('calHolidayNote');
    const cache = new Map();
    let view = null, sequence = 0, controller, latest = null, state = 'idle', selectedRegion = null;
    for (const [id,label] of WEATHER_REGIONS) {
        const option = doc.createElement('option'); option.value=id; option.textContent=label; select.append(option);
    }
    function savedRegion() {
        if (selectedRegion) return selectedRegion;
        try { const key=win.localStorage.getItem(STORAGE_KEY); if (WEATHER_REGIONS.some(r=>r[0]===key)) return key; } catch {}
        return 'seoul';
    }
    select.value=savedRegion();
    const region = () => WEATHER_REGIONS.find(r=>r[0]===select.value) || WEATHER_REGIONS[0];
    const element = (tag, className, text) => { const el=doc.createElement(tag);el.className=className;el.textContent=text;return el; };
    const statusText = (text, error=false) => { status.textContent=text;status.classList.toggle('is-error',error); };
    const fresh = (item, today) => item && item.today === today && now()-item.fetchedAt >= 0 && now()-item.fetchedAt < 20*60000;
    function paint() {
        if (!view) return;
        const [,label,lat,lon]=region(), today=koreanDateKey(now()), end=shiftCalendarDate(today,15);
        const holidays=getKoreanHolidays(view.year);
        note.textContent=!holidays.supported ? '공휴일 표시는 2014~2100년을 지원합니다.' : !holidays.lunarSupported ?
            '이 브라우저에서는 음력 공휴일을 계산할 수 없습니다. 최신 브라우저에서 확인해 주세요.' :
            '공휴일 기준: 2026.10 · 이후 임시공휴일·선거일은 추가 공고에 따라 달라질 수 있어요.';
        for (const cell of grid.querySelectorAll('.cal-day[data-date]')) {
            const key=cell.dataset.date, astronomy=calendarAstronomy(key,lat,lon);
            if (!astronomy) continue;
            cell.querySelector('.cal-environment')?.remove();
            const box=element('span','cal-environment',''); box.setAttribute('aria-hidden','true');
            const names=(holidays.dates.get(key)||[]).map(h=>h.name);
            cell.classList.toggle('cal-holiday',names.length>0);
            if (names.length) {
                const holiday=element('span','cal-holiday-name',names.map(name=>name.startsWith('대체공휴일')?'대체공휴일':name).join('·'));
                holiday.title=names.join(' · ');box.append(holiday);
            }
            const weather=latest?.dates.get(key);
            const missing=key<today?'지난 날':key>end?'예보 전':state==='loading'?'조회 중':state==='error'?'조회 실패':'예보 없음';
            const weatherBox=element('span','cal-weather','');
            if (weather) {
                weatherBox.append(element('span','cal-weather-icon',weather.icon));
                const temperatures=element('span','cal-weather-temp',weather.min===null?'기온 없음':'');
                if (weather.min!==null) temperatures.append(element('span','cal-temp-low',`${Math.round(weather.min)}°`),
                    element('span','cal-temp-divider','/'),element('span','cal-temp-high',`${Math.round(weather.max)}°`));
                weatherBox.append(temperatures);
            } else weatherBox.append(element('span','cal-weather-missing',missing));
            const weatherLabel=weather?`${weather.description}${weather.min===null?', 기온 미제공':`, 최저 ${weather.min}도, 최고 ${weather.max}도`}`:
                key<today?'지난 날짜의 날씨는 제공하지 않습니다':key>end?'예보 제공 기간 전':missing;
            weatherBox.title=weatherLabel;
            const sun=element('span','cal-sun-times','');
            sun.append(element('span','cal-sunrise',`↑${astronomy.sunrise}`),element('span','cal-sunset',`↓${astronomy.sunset}`));
            sun.title=`${label} 일출 ${astronomy.sunrise} · 일몰 ${astronomy.sunset} (한국 시각, 계산값)`;
            const moon=element('span','cal-moon',astronomy.moon.icon); moon.title=`${astronomy.moon.label} · 밝은 면 ${astronomy.moon.illumination}% (한국 정오 기준 근사값)`;
            box.append(weatherBox,sun,moon);
            // Keep range/record badges below environmental information, with existing click actions intact.
            const number=cell.querySelector('.cal-day-number');
            if (number) number.after(box); else cell.prepend(box);
            if (!cell.dataset.environmentBaseLabel) cell.dataset.environmentBaseLabel=cell.dataset.scheduleBaseLabel || cell.getAttribute('aria-label') || key;
            if (cell.dataset.environmentBaseTitle===undefined) cell.dataset.environmentBaseTitle=cell.title;
            const description=[...names,`${label} 기준`,weatherLabel,`일출 ${astronomy.sunrise}`,`일몰 ${astronomy.sunset}`,
                `${astronomy.moon.label}, 밝은 면 ${astronomy.moon.illumination}%`].join(', ');
            const base=`${cell.dataset.environmentBaseLabel}, ${description}`;
            const previous=cell.dataset.scheduleBaseLabel;
            const scheduleSuffix=previous && cell.getAttribute('aria-label')?.startsWith(previous) ? cell.getAttribute('aria-label').slice(previous.length) : '';
            if (previous!==undefined) cell.dataset.scheduleBaseLabel=base;
            cell.setAttribute('aria-label',base+scheduleSuffix);
            cell.title=[cell.dataset.environmentBaseTitle,description].filter(Boolean).join('\n');
        }
    }
    async function render(year, month, {force=false} = {}) {
        view={year,month};
        const request=++sequence;controller?.abort();controller=null;
        await afterPaint(win);
        if (request!==sequence) return;
        select.value=savedRegion();
        const [key,label,lat,lon]=region(), today=koreanDateKey(now());
        const monthPrefix=`${year}-${String(month+1).padStart(2,'0')}`;
        const end=shiftCalendarDate(today,15), eligible=monthPrefix>=today.slice(0,7)&&monthPrefix<=end.slice(0,7);
        latest=null; state=eligible?'loading':'idle';retry.hidden=!eligible;
        if (!eligible) {statusText(`${label} · 한국 시각(KST) · 이 달은 현재 예보 제공 범위 밖입니다.`);paint();return;}
        let cached=cache.get(key);
        if (!cached) {
            try {
                const saved=JSON.parse(win.sessionStorage.getItem(`alcoholaway-calendar-weather-${key}`));
                if (saved?.today===today && Number.isFinite(saved.fetchedAt)) cached={...saved,dates:parseCalendarForecast(saved.data,today)};
            } catch {}
        }
        if (!force && fresh(cached,today)) {latest=cached;state='ready';paint();showLoaded(label);return;}
        statusText(`${label} · 한국 시각(KST) · 날씨 예보를 불러오는 중…`);paint();
        const ownController=new win.AbortController();controller=ownController;
        const timer=win.setTimeout(()=>ownController.abort(),12000);
        try {
            const url=new URL('https://api.open-meteo.com/v1/forecast');
            url.search=new URLSearchParams({latitude:lat,longitude:lon,timezone:'Asia/Seoul',forecast_days:'16',
                daily:'weather_code,temperature_2m_min,temperature_2m_max',temperature_unit:'celsius'}).toString();
            const response=await fetch(url.toString(),{signal:ownController.signal,credentials:'omit',referrerPolicy:'no-referrer'});
            if (!response.ok) throw new Error('Forecast unavailable');
            const data=await response.json();
            if (request!==sequence) return;
            if (ownController.signal.aborted) throw new Error('Forecast timeout');
            if (today!==koreanDateKey(now())) {void render(year,month);return;}
            latest={today,dates:parseCalendarForecast(data,today),fetchedAt:now()};
            cache.set(key,latest);state='ready';paint();showLoaded(label);
            try { win.sessionStorage.setItem(`alcoholaway-calendar-weather-${key}`,JSON.stringify({today,data,fetchedAt:latest.fetchedAt})); } catch {}
        } catch {
            if (request!==sequence) return;
            state='error';latest=null;paint();statusText(`${label} · 날씨를 불러오지 못했어요. 예보 새로고침을 눌러 주세요.`,true);
        } finally {win.clearTimeout(timer);}
    }
    function showLoaded(label) {
        const keys=[...latest.dates.keys()].sort();
        statusText(`${label} · 한국 시각(KST) · 예보 ${keys[0].slice(5).replace('-','/')}~${keys.at(-1).slice(5).replace('-','/')} · ${CLOCK.format(new Date(latest.fetchedAt))} 조회`);
    }
    select.addEventListener('change',()=>{
        selectedRegion=select.value;
        try {win.localStorage.setItem(STORAGE_KEY,select.value);} catch {}
        if(view)void render(view.year,view.month);
    });
    retry.addEventListener('click',()=>{if(view)void render(view.year,view.month,{force:true});});
    win.setInterval(()=>{
        if(view && latest && latest.today!==koreanDateKey(now()) && doc.getElementById('calendarModal')?.getClientRects().length) void render(view.year,view.month);
    },60000);
    return {render};
}
