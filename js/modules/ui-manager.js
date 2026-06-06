/**
 * UI 업데이트 관련 함수들
 */

export function updateGreetingUI(userProfile) {
    const greetingTexts = document.querySelectorAll('.user-display-name');
    const visitStats = document.querySelectorAll('.visit-stats');

    const nameStr = userProfile.nickname || "도전자";
    greetingTexts.forEach(el => el.innerText = `${nameStr}님 환영합니다! ✏️`);

    if (userProfile.totalVisits > 0) {
        visitStats.forEach(el => {
            el.innerText = `(오늘 ${userProfile.todayVisits}번째, 전체 ${userProfile.totalVisits}번째 방문)`;
        });
    }
}

export function updateRangeStyle(rangeElement, valueSpanId) {
    const value = rangeElement.value;
    const max = rangeElement.max;
    const percentage = (value / max) * 100;
    
    // CSS 변수 업데이트
    rangeElement.style.setProperty('--range-progress', `${percentage}%`);
    
    // 색상 결정
    let color = '#f39c12';
    if (value <= 3) color = '#2ecc71';
    else if (value <= 6) color = '#f39c12';
    else color = '#e74c3c';
    
    rangeElement.style.setProperty('--range-color', color);
    
    // 값 표시 업데이트
    if (valueSpanId) {
        const valueSpan = document.getElementById(valueSpanId);
        if (valueSpan) {
            valueSpan.innerText = value;
            valueSpan.style.color = color;
        }
    }
}

export function markTouched(rangeElement) {
    rangeElement.setAttribute('data-touched', 'true');
}
