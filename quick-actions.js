// Records retain their original diary handlers; the picker only chooses a target.
export function activeDiagnosisChoices(entries, today, validDate, recovered) {
    return (entries || []).flatMap(entry => (Array.isArray(entry.diagnoses) ? entry.diagnoses : [])
        .map((diagnosis, index) => ({...diagnosis, entryId:entry.id, index,
            key:JSON.stringify([entry.id, diagnosis.id || [diagnosis.name, diagnosis.date]])}))
        .filter(d => validDate(d.date) && d.date <= today && !recovered(d)))
        .sort((a,b) => b.date.localeCompare(a.date) || String(a.name).localeCompare(String(b.name), 'ko'));
}

export function installQuickActions({document:dom = document, account, health, openDiary, newDiagnosis}) {
    const diagnosis = dom.getElementById('quickDiagnosisDialog'), games = dom.getElementById('gamePickerDialog');
    const list = dom.getElementById('quickDiagnosisList'), status = dom.getElementById('quickDiagnosisStatus');
    let owner = null;
    for (const dialog of [diagnosis, games]) {
        dialog.querySelector('[data-quick-close]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', event => {if (event.target === dialog) {
            const r = dialog.getBoundingClientRect();
            if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
        }});
    }
    function choose(key) {
        if (!owner || account() !== owner) return close();
        const state = health();
        if (state.loading || state.error || state.busy) return render();
        const current = state.choices.find(item => item.key === key);
        if (!current) return render();
        diagnosis.close(); openDiary(current.entryId, current.index);
    }
    function render() {
        if (!diagnosis.open) return;
        if (!owner || account() !== owner) return close();
        const state = health(); list.replaceChildren();
        status.textContent = state.error ? '질환 기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'
            : state.loading ? '질환 기록을 불러오는 중…'
            : state.busy ? '기존 기록을 저장하는 중입니다. 잠시 후 다시 선택해 주세요.'
            : state.choices.length ? '오늘 기록할 질환을 선택하세요.' : '회복 중인 질환이 없습니다.';
        if (state.loading || state.error) return;
        for (const item of state.choices) {
            const button = dom.createElement('button'); button.type = 'button'; button.className = 'quick-choice';
            const name = dom.createElement('strong'), detail = dom.createElement('small');
            name.textContent = item.name || '이름 없는 질환'; detail.textContent = `${item.date} 진단 · 다이어리 쓰기 →`;
            button.append(name, detail);
            button.addEventListener('click', () => choose(item.key)); list.append(button);
        }
        if (!state.choices.length) {
            const button = dom.createElement('button'); button.type = 'button'; button.className = 'quick-choice';
            button.textContent = '오늘 진단 기록 추가';
            button.addEventListener('click', () => {if (account() === owner && !health().busy) {diagnosis.close(); newDiagnosis();} else render();}); list.append(button);
        }
    }
    function close() { owner = null; for (const dialog of [diagnosis, games]) if (dialog.open) dialog.close(); }
    games.addEventListener('click', event => {if (event.target.closest('a') && (!owner || account() !== owner)) {event.preventDefault(); close();}});
    return {
        close, refreshDiagnoses:render,
        openGames() {owner = account(); if (owner && !games.open) games.showModal();},
        openDiagnoses() {
            owner = account(); if (!owner) return;
            const state = health();
            if (!state.loading && !state.error && !state.busy && state.choices.length === 1) return choose(state.choices[0].key);
            if (!diagnosis.open) diagnosis.showModal(); render();
        }
    };
}
