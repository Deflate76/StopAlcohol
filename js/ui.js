export function openModal(id) {
    document.getElementById(id).style.display = 'flex';
}

export function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

export function toggleEtc(val) {
    document.getElementById('etcReason').style.display = (val === '기타') ? 'block' : 'none';
}

export function markTouched(el) {
    el.setAttribute('data-touched', 'true');
}

export function updateRangeStyle(el, textId) {
    const val = parseInt(el.value);
    const minStr = el.getAttribute('min'); 
    const min = minStr !== null ? parseInt(minStr) : 1;
    const maxStr = el.getAttribute('max'); 
    const max = maxStr !== null ? parseInt(maxStr) : 10;
    const percent = ((val - min) / (max - min)) * 100;
    const isTouched = el.getAttribute('data-touched') === 'true';

    if (!isTouched && el.closest('#stateModal')) {
        el.style.setProperty('--range-color', '#cbd5e0'); 
        el.style.setProperty('--range-percent', `50%`);
        if (textId) { 
            const textEl = document.getElementById(textId); 
            if (textEl) { textEl.innerText = '-'; textEl.style.color = '#a0aec0'; } 
        }
        return;
    }

    const hue = 120 - ((val - min) / (max - min)) * 120;
    const color = `hsl(${hue}, 85%, 45%)`; 
    el.style.setProperty('--range-color', color); 
    el.style.setProperty('--range-percent', `${percent}%`);
    if (textId) { 
        const textEl = document.getElementById(textId); 
        if (textEl) { textEl.innerText = val; textEl.style.color = color; } 
    }
}

export function resetStateModal() {
    const ranges = ['withdrawalRange', 'moodRange', 'thirstRange', 'fatigueRange', 'stressRange', 'sleepRange', 'hungerRange'];
    const valIds = ['withdrawalVal', 'moodVal', 'thirstVal', 'fatigueVal', 'stressVal', 'sleepVal', 'hungerVal'];
    ranges.forEach((id, index) => {
        const el = document.getElementById(id);
        if(el) { 
            el.value = 5; 
            el.setAttribute('data-touched', 'false'); 
            updateRangeStyle(el, valIds[index]); 
        }
    });
}
