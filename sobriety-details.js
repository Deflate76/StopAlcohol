export function renderSobrietyDetails(document, result, state = {}) {
    const body = document.getElementById('sobrietyRateDetails'); body.replaceChildren();
    const make = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
    if (!result?.totalDays || result.percent == null) {
        body.append(make('p', state.error ? '음주 기록을 확인하지 못해 금주율을 계산할 수 없습니다. 연결 상태를 확인한 뒤 다시 열어 주세요.'
            : state.loading ? '금주 도전과 음주 기록을 불러오고 있습니다…'
                : '계정 생성일 이후에 시작한 금주 도전이 있어야 계산할 수 있습니다.', 'health-muted'));
        return;
    }
    const exact = result.soberDays / result.totalDays * 100;
    const card = make('div', undefined, 'sobriety-rate-card');
    card.append(make('div', '나의 금주율 · 기록 기준', 'health-muted'), make('div', `${result.percent}%`, 'sobriety-rate-number'));
    const end = new Date(Date.parse(result.startDate + 'T00:00:00Z') + (result.totalDays - 1) * 86400000).toISOString().slice(0, 10);
    card.append(make('p', `${result.startDate} ~ ${end} · 시작일과 오늘 포함`, 'health-muted'));
    const bar = make('div', undefined, 'sobriety-rate-bar'); bar.setAttribute('role','img');
    bar.setAttribute('aria-label', `전체 ${result.totalDays}일 중 금주 ${result.soberDays}일, 음주 기록 ${result.drinkingDays}일`);
    const sober = make('span'); sober.style.width = `${exact}%`; bar.append(sober); card.append(bar);
    const legend = make('div', undefined, 'sobriety-rate-legend'); legend.append(make('span', `● 금주 ${result.soberDays}일`), make('span', `● 음주 ${result.drinkingDays}일`)); card.append(legend); body.append(card);
    body.append(make('h4', '이렇게 계산했어요'));
    body.append(make('p', '(금주 도전일수 − 음주 기록일수) ÷ 금주 도전일수 × 100', 'health-muted'));
    body.append(make('p', `(${result.totalDays} − ${result.drinkingDays}) ÷ ${result.totalDays} × 100 = ${exact.toFixed(2)}% → ${result.percent}%`, 'sobriety-rate-formula'));
    const facts = make('dl', undefined, 'sobriety-rate-facts');
    for (const [label, value] of [['전체 도전일수', `${result.totalDays}일`],['음주가 기록된 날짜', `${result.drinkingDays}일`],['금주일수', `${result.soberDays}일`]]) facts.append(make('dt', label), make('dd', value));
    body.append(facts);
    body.append(make('p', '계정 생성일 이후 첫 도전일부터 오늘까지, 도전 사이의 공백도 포함합니다. 한국 날짜로 계산하고 같은 날 여러 번 마셔도 1일로 셉니다. 일일 기록·실패 기록·음주 조절 기록의 실제 음주량을 합쳐 확인합니다. 배지는 소수점 첫째 자리에서 반올림합니다.', 'health-muted'));
    body.append(make('p', '음주 기록이 없는 날은 금주일로 계산됩니다. 누락된 음주 기록을 입력하면 비율도 달라집니다.', 'health-muted'));
}
