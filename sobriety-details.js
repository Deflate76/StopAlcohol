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
    if (state.history?.daily?.length) renderSobrietyHistory(document, body, state.history);
    body.append(make('h4', '이렇게 계산했어요'));
    body.append(make('p', '(금주 도전일수 − 음주 기록일수) ÷ 금주 도전일수 × 100', 'health-muted'));
    body.append(make('p', `(${result.totalDays} − ${result.drinkingDays}) ÷ ${result.totalDays} × 100 = ${exact.toFixed(2)}% → ${result.percent}%`, 'sobriety-rate-formula'));
    const facts = make('dl', undefined, 'sobriety-rate-facts');
    for (const [label, value] of [['전체 도전일수', `${result.totalDays}일`],['음주가 기록된 날짜', `${result.drinkingDays}일`],['금주일수', `${result.soberDays}일`]]) facts.append(make('dt', label), make('dd', value));
    body.append(facts);
    body.append(make('p', '계정 생성일 이후 첫 도전일부터 오늘까지, 도전 사이의 공백도 포함합니다. 한국 날짜로 계산하고 같은 날 여러 번 마셔도 1일로 셉니다. 일일 기록·실패 기록·음주 조절 기록의 실제 음주량을 합쳐 확인합니다. 배지는 소수점 첫째 자리에서 반올림합니다.', 'health-muted'));
    body.append(make('p', '음주 기록이 없는 날은 금주일로 계산됩니다. 누락된 음주 기록을 입력하면 비율도 달라집니다.', 'health-muted'));
}

function renderSobrietyHistory(document, body, history) {
    const make = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
    const section = make('section', undefined, 'sobriety-history'); section.setAttribute('aria-labelledby', 'sobrietyTrendTitle');
    const title = make('h4', '날짜별 누적 금주율'); title.id = 'sobrietyTrendTitle';
    section.append(title, make('p', '첫 도전일부터 각 날짜까지의 금주율입니다. 선을 누르거나 날짜를 선택해 보세요.', 'health-muted'));
    const toolbar = make('div', undefined, 'sobriety-trend-tools'); toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','그래프 표시 기간');
    let period = 'all', selected = history.daily.length - 1, offset = 0;
    const options = [['30','최근 30일'],['90','최근 90일'],['all','전체']];
    for (const [value, label] of options) {
        const button = make('button', label, 'health-btn'); button.type = 'button'; button.dataset.period = value;
        button.addEventListener('click', () => { period = value; selected = history.daily.length - 1; draw(); }); toolbar.append(button);
    }
    section.append(toolbar);
    const ns = 'http://www.w3.org/2000/svg';
    const svgNode = (name, attrs = {}, text) => { const el = document.createElementNS(ns,name); for (const [key,val] of Object.entries(attrs)) el.setAttribute(key,String(val)); if (text !== undefined) el.textContent = text; return el; };
    const svg = svgNode('svg',{viewBox:'0 0 420 210',role:'img','aria-labelledby':'sobrietyTrendTitle sobrietyTrendDescription',class:'sobriety-trend-chart'});
    section.append(svg);
    const selection = make('div',undefined,'sobriety-trend-selection');
    const dateLabel = make('label','날짜 '), date = make('input'); date.type = 'date'; date.id = 'sobrietyTrendDate';
    date.min = history.daily[0].date; date.max = history.daily.at(-1).date; dateLabel.append(date);
    const output = make('output'); output.id = 'sobrietyTrendValue'; output.setAttribute('aria-live','polite');
    selection.append(dateLabel,output); section.append(selection);
    const sliderLabel = make('label','날짜 이동','sr-only'); sliderLabel.htmlFor = 'sobrietyTrendSlider';
    const slider = make('input'); slider.type = 'range'; slider.id = 'sobrietyTrendSlider'; slider.step = '1'; slider.setAttribute('aria-label','날짜별 금주율 확인');
    section.append(sliderLabel,slider); body.append(section);
    const left=42,right=405,top=18,bottom=173;
    let visible = [], cursor, point;
    const x = index => visible.length > 1 ? left + index / (visible.length - 1) * (right-left) : (left+right)/2;
    const y = percent => bottom - percent / 100 * (bottom-top);
    function select(index) {
        selected = Math.max(offset,Math.min(history.daily.length-1,index));
        const row=history.daily[selected]; date.value=row.date; slider.value=String(selected);
        output.replaceChildren(make('strong',`${row.percent.toFixed(2)}%`),make('span',`금주 ${row.soberDays} / ${row.totalDays}일 · ${row.drank ? '이날 음주 기록 있음' : '이날 음주 기록 없음'}`));
        slider.setAttribute('aria-valuetext',`${row.date}, 누적 금주율 ${row.percent.toFixed(2)}%`);
        cursor.setAttribute('x1',x(selected-offset));cursor.setAttribute('x2',x(selected-offset));
        point.setAttribute('cx',x(selected-offset));point.setAttribute('cy',y(row.percent));
    }
    function draw() {
        offset = period==='all' ? 0 : Math.max(0,history.daily.length-Number(period)); visible = history.daily.slice(offset);
        for (const button of toolbar.children) button.setAttribute('aria-pressed',String(button.dataset.period===period));
        svg.replaceChildren(svgNode('desc',{id:'sobrietyTrendDescription'},`${visible[0].date}부터 ${visible.at(-1).date}까지 날짜별 누적 금주율. 세로축 0~100%. 아래 날짜 선택으로 정확한 값을 확인할 수 있습니다.`));
        for (const value of [0,25,50,75,100]) {
            svg.append(svgNode('line',{x1:left,x2:right,y1:y(value),y2:y(value),class:'sobriety-grid-line'}),svgNode('text',{x:left-7,y:y(value)+4,'text-anchor':'end',class:'sobriety-axis-label'},`${value}%`));
        }
        const points=visible.map((row,i)=>`${x(i).toFixed(2)},${y(row.percent).toFixed(2)}`).join(' ');
        svg.append(svgNode('polyline',{points,fill:'none',class:'sobriety-trend-line','vector-effect':'non-scaling-stroke','stroke-linejoin':'round'}));
        const ticks = new Set([0,Math.floor((visible.length-1)/2),visible.length-1]);
        for (const i of ticks) svg.append(svgNode('text',{x:x(i),y:bottom+24,'text-anchor':visible.length===1?'middle':i===0?'start':i===visible.length-1?'end':'middle',class:'sobriety-axis-label'},visible[i].date.slice(2).replaceAll('-','.')));
        cursor=svgNode('line',{y1:top,y2:bottom,class:'sobriety-trend-cursor'});
        point=svgNode('circle',{r:4.5,class:'sobriety-trend-point'});svg.append(cursor,point);
        slider.min=String(offset);slider.max=String(history.daily.length-1);slider.disabled=visible.length===1;
        select(selected);
    }
    svg.addEventListener('click',event=>{
        const rect=svg.getBoundingClientRect();if(!rect.width)return;
        const position=(event.clientX-rect.left)/rect.width*420;
        select(offset+Math.round((position-left)/(right-left)*Math.max(0,visible.length-1)));
    });
    slider.addEventListener('input',()=>select(Number(slider.value)));
    date.addEventListener('change',()=>{
        const index=history.daily.findIndex(row=>row.date===date.value);
        if(index<0){date.value=history.daily[selected].date;return;}
        selected=index;if(index<offset){period='all';draw();}else select(index);
    });
    draw();

    const weekly = make('section',undefined,'sobriety-weekly');weekly.setAttribute('aria-labelledby','sobrietyWeeklyTitle');
    const heading=make('h4','주별 금주율 기록표');heading.id='sobrietyWeeklyTitle';
    weekly.append(heading,make('p','월요일~일요일 기준입니다. 각 주의 금주일 ÷ 집계일수로 계산하며, 첫 주는 도전 시작일부터, 이번 주는 오늘까지만 포함합니다.','health-muted'));
    const table=make('table');table.className='sobriety-weekly-table';
    const caption=make('caption','최근 주부터 표시 · 금주율은 해당 주의 비율');table.append(caption);
    const head=make('thead'),header=make('tr');
    for(const label of ['기간','금주','음주','금주율']){const th=make('th',label);th.scope='col';header.append(th);}head.append(header);table.append(head);
    const rows=make('tbody');table.append(rows);weekly.append(table);
    const more=make('button','이전 주 더 보기','health-btn');more.type='button';let count=12;
    function showWeeks(){
        rows.replaceChildren();
        for(const week of history.weeks.slice(0,count)){
            const tr=make('tr'),range=make('th');range.scope='row';
            const from=make('time',week.startDate.replaceAll('-','.'));from.dateTime=week.startDate;
            const to=make('span',`~ ${week.endDate.slice(5).replace('-','.')}`);const meta=make('small',`${week.totalDays}일 집계${week.current?' · 이번 주':''}`);
            range.append(from,to,meta);tr.append(range,make('td',`${week.soberDays}일`),make('td',`${week.drinkingDays}일`),make('td',`${week.percent.toFixed(1)}%`));
            rows.append(tr);
        }
        more.hidden=count>=history.weeks.length;more.textContent=`이전 주 더 보기 (${Math.max(0,history.weeks.length-count)}주)`;
    }
    more.addEventListener('click',()=>{count+=12;showWeeks();});weekly.append(more);body.append(weekly);showWeeks();
}
