// Daily clock risk and on-demand weather. No health or account data is sent to the weather provider.
export function failureTimeStats(challenges, nowMs = Date.now()) {
    const counts = Array(12).fill(0);
    let skipped = 0;
    for (const item of challenges || []) {
        if (item.status !== 'failed') continue;
        const value = item.endDate;
        const missingTime = item.hasRecordedEndDate === false || item.hasRecordedEndTime === false
            || value == null || value === '' || (typeof value === 'string' && !/T\d{2}:\d{2}/.test(value));
        const date = value?.toDate ? value.toDate() : new Date(value);
        if (missingTime || !Number.isFinite(date.getTime()) || date.getTime() > nowMs) { skipped++; continue; }
        counts[Math.floor(date.getHours() / 2)]++;
    }
    const max = Math.max(...counts);
    return { counts, max, total: counts.reduce((a, b) => a + b, 0), skipped,
        peaks: counts.flatMap((count, index) => max > 0 && count === max ? [index] : []) };
}

export function renderFailureTimeRisk(document, challenges, { error = false, loading = false } = {}) {
    const layer = document.getElementById('subFailureSegments'), summary = document.getElementById('subFailureSummary');
    if (!layer || !summary) return;
    const stats = failureTimeStats(error || loading ? [] : challenges);
    const label = index => `${String(index * 2).padStart(2, '0')}~${String(index * 2 + 2).padStart(2, '0')}시`;
    layer.replaceChildren();
    stats.counts.forEach((count, index) => {
        const cell = document.createElement('span');
        cell.className = 'sub-failure-segment'; cell.classList.toggle('is-peak', stats.peaks.includes(index));
        cell.title = `${label(index)} · 단주 실패 ${count}회`; layer.append(cell);
    });
    summary.textContent = error ? '실패 시간대를 불러오지 못했습니다.' : loading ? '실패 시간대를 불러오는 중…'
        : stats.max ? `🟠 실패 최다: ${stats.peaks.map(label).join(', ')} · ${stats.peaks.length > 1 ? '각 ' : ''}${stats.max}회`
        : '시간이 확인되는 단주 실패 기록이 없습니다.';
    if (stats.skipped && !error && !loading) summary.textContent += ` (시각 미확인 등 ${stats.skipped}건 제외)`;
    summary.title = '전체 단주 기록을 2시간씩 12구간으로 집계합니다. 최다 횟수가 같으면 모두 표시합니다. 기기의 현지 시각 기준입니다.';
}

export const WEATHER_REGIONS = Object.freeze([
    ['seoul', '서울', 37.57, 126.98], ['yongin', '용인', 37.24, 127.18],
    ['suji', '용인 수지·광교', 37.32, 127.09], ['suwon', '수원', 37.26, 127.03],
    ['seongnam', '성남', 37.42, 127.13], ['incheon', '인천', 37.46, 126.71],
    ['chuncheon', '춘천', 37.88, 127.73], ['gangneung', '강릉', 37.75, 128.88],
    ['cheongju', '청주', 36.64, 127.49], ['daejeon', '대전', 36.35, 127.38],
    ['sejong', '세종', 36.48, 127.29], ['jeonju', '전주', 35.82, 127.15],
    ['gwangju', '광주', 35.16, 126.85], ['daegu', '대구', 35.87, 128.60],
    ['busan', '부산', 35.18, 129.08], ['ulsan', '울산', 35.54, 129.31],
    ['changwon', '창원', 35.23, 128.68], ['jeju', '제주', 33.50, 126.53]
]);

export function weatherDescription(code) {
    const descriptions = {0:'☀️ 맑음',1:'🌤️ 대체로 맑음',2:'⛅ 구름 조금',3:'☁️ 흐림',
        45:'🌫️ 안개',48:'🌫️ 얼음 안개',51:'🌦️ 약한 이슬비',53:'🌦️ 이슬비',55:'🌧️ 강한 이슬비',
        56:'🌧️ 어는 이슬비',57:'🌧️ 강한 어는 이슬비',61:'🌦️ 약한 비',63:'🌧️ 비',65:'🌧️ 강한 비',
        66:'🌧️ 어는 비',67:'🌧️ 강한 어는 비',71:'🌨️ 약한 눈',73:'🌨️ 눈',75:'❄️ 강한 눈',77:'❄️ 싸락눈',
        80:'🌦️ 약한 소나기',81:'🌧️ 소나기',82:'🌧️ 강한 소나기',85:'🌨️ 눈 소나기',86:'❄️ 강한 눈 소나기',
        95:'⛈️ 뇌우',96:'⛈️ 우박 동반 뇌우',97:'⛈️ 강한 뇌우',99:'⛈️ 강한 우박 동반 뇌우'};
    return Number.isInteger(code) ? descriptions[code] || '기상상황 미확인' : '기상상황 미확인';
}

const weatherDate = (nowMs, offset) => new Date(nowMs + offset * 1000).toISOString().slice(0, 10);
export function parseTodayWeather(data, nowMs = Date.now()) {
    if (!Number.isFinite(data?.utc_offset_seconds)) throw new Error('날씨 시간대를 확인할 수 없습니다. 다시 조회해 주세요.');
    const date = weatherDate(nowMs, data.utc_offset_seconds);
    const index = data.daily?.time?.indexOf(date) ?? -1;
    const min = data.daily?.temperature_2m_min?.[index], max = data.daily?.temperature_2m_max?.[index];
    if (index < 0 || !Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error('오늘의 최저·최고 기온이 없습니다. 잠시 후 다시 조회해 주세요.');
    const current = data.current?.time?.startsWith(date) ? data.current : {};
    return { date, offset: data.utc_offset_seconds, min, max,
        temperature: Number.isFinite(current.temperature_2m) ? current.temperature_2m : null,
        current: weatherDescription(current.weather_code), daily: weatherDescription(data.daily.weather_code?.[index]),
        time: typeof current.time === 'string' ? current.time.slice(11, 16) : '' };
}

export function installTodayWeather({ document = globalThis.document, window = globalThis.window,
    fetch = (...args) => window.fetch(...args), now = Date.now } = {}) {
    const dialog = document.getElementById('todayWeatherModal');
    if (!dialog) return;
    const get = id => document.getElementById(id), select = get('weatherRegion');
    const buttons = [...document.querySelectorAll('[data-weather-open]')];
    const cache = new Map();
    let sequence = 0, controller, activePlace = null, latest = null;
    for (const [id, name] of WEATHER_REGIONS) {
        const option = document.createElement('option'); option.value = id; option.textContent = name; select.append(option);
    }
    try { select.value = window.localStorage.getItem('alcoholaway-weather-region') || ''; } catch {}
    const region = () => { const row = WEATHER_REGIONS.find(r => r[0] === select.value); return row ? {key:row[0],label:row[1],lat:row[2],lon:row[3]} : null; };
    const status = (text, error = false) => { get('weatherStatus').textContent = text; get('weatherStatus').classList.toggle('is-error', error); };
    const fresh = item => item && now() - item.fetchedAt < 20 * 60 * 1000 && item.weather.date === weatherDate(now(), item.weather.offset);
    function resetSummary() { buttons.forEach(button => { button.textContent = '🌤 오늘 날씨'; button.title = '오늘 날씨 조회'; }); }
    function render(item) {
        latest = item;
        const {weather:w, place} = item;
        get('weatherResult').hidden = false;
        get('weatherPlace').textContent = `${place.label} · ${w.date}`;
        get('weatherCurrent').textContent = w.temperature === null ? '현재 기온 미확인' : `${w.current} · 현재 ${w.temperature.toFixed(1)}°C`;
        get('weatherMin').textContent = `${w.min.toFixed(1)}°C`; get('weatherMax').textContent = `${w.max.toFixed(1)}°C`;
        get('weatherCondition').textContent = `오늘 예보: ${w.daily}`;
        get('weatherUpdated').textContent = `${w.time ? `현재 날씨 ${w.time} 기준 · ` : ''}조회 ${new Date(item.fetchedAt).toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'})}`;
        buttons.forEach(button => { button.textContent = `${w.daily} ${Math.round(w.min)}°/${Math.round(w.max)}°`; button.title = `${place.label} · ${w.date} · 최저 ${w.min}°C / 최고 ${w.max}°C · 자세히 보기`; });
    }
    async function lookup(place, force = false) {
        const request = ++sequence;
        controller?.abort(); controller = new window.AbortController();
        activePlace = place; latest = null; get('weatherResult').hidden = true; resetSummary();
        const cached = cache.get(place.key);
        if (!force && fresh(cached)) { render(cached); status('최근 조회한 오늘 날씨입니다.'); return; }
        status(`${place.label} 날씨를 불러오는 중…`);
        const ownController = controller;
        const timeout = window.setTimeout(() => ownController.abort(), 12000);
        try {
            const url = new URL('https://api.open-meteo.com/v1/forecast');
            url.search = new URLSearchParams({latitude:place.lat, longitude:place.lon,
                current:'temperature_2m,weather_code', daily:'temperature_2m_min,temperature_2m_max,weather_code',
                timezone:'auto', forecast_days:'2', temperature_unit:'celsius'}).toString();
            const response = await fetch(url.toString(), {signal:ownController.signal, credentials:'omit', referrerPolicy:'no-referrer'});
            if (!response.ok) throw new Error('날씨를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.');
            const data = await response.json();
            if (request !== sequence) return;
            const item = {place, weather:parseTodayWeather(data, now()), fetchedAt:now()};
            cache.set(place.key, item); render(item); status('');
        } catch (error) {
            if (request === sequence) status(error.name === 'AbortError' ? '날씨 조회 시간이 초과되었습니다. 다시 조회해 주세요.' : '날씨를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 조회해 주세요.', true);
        } finally { window.clearTimeout(timeout); }
    }
    function locate() {
        const request = ++sequence; controller?.abort();
        get('weatherResult').hidden = true; latest = null; activePlace = null; resetSummary();
        if (!window.navigator.geolocation) { status('현재 위치를 사용할 수 없습니다. 지역을 선택해 주세요.', true); return; }
        status('현재 위치를 확인하고 있습니다…');
        window.navigator.geolocation.getCurrentPosition(position => {
            if (request !== sequence) return;
            const lat = Number(position.coords.latitude.toFixed(2)), lon = Number(position.coords.longitude.toFixed(2));
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { status('현재 위치를 확인하지 못했습니다. 지역을 선택해 주세요.', true); return; }
            select.value = '';
            void lookup({key:`geo:${lat},${lon}`,label:'현재 위치 주변',lat,lon});
        }, error => {
            if (request === sequence) status(error.code === 1 ? '위치 권한이 꺼져 있습니다. 아래에서 지역을 선택해 주세요.' : '현재 위치를 확인하지 못했습니다. 지역을 선택해 주세요.', true);
        }, {enableHighAccuracy:false, timeout:10000, maximumAge:300000});
    }
    buttons.forEach(button => button.addEventListener('click', () => {
        if (!dialog.open) dialog.showModal();
        if (fresh(latest)) render(latest);
        else { get('weatherResult').hidden = true; resetSummary(); const place = activePlace || region(); if (place) void lookup(place); else status('현재 위치 또는 지역을 선택해 주세요.'); }
    }));
    get('weatherClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { sequence++; controller?.abort(); });
    get('weatherLocate').addEventListener('click', locate);
    get('weatherLookup').addEventListener('click', () => { const place = region(); if (place) { try { window.localStorage.setItem('alcoholaway-weather-region', place.key); } catch {} void lookup(place); } else status('조회할 지역을 선택해 주세요.', true); });
    get('weatherRefresh').addEventListener('click', () => { if (activePlace) void lookup(activePlace, true); else status('현재 위치 또는 지역을 선택해 주세요.', true); });
    // Clear yesterday's summary even when the tab stays open overnight. Never request location automatically.
    window.setInterval(() => { if (latest && !fresh(latest)) { resetSummary(); get('weatherResult').hidden = true; latest = null; if (dialog.open) status('새로운 날씨를 조회해 주세요.'); } }, 60000);
    return {lookup, locate};
}
