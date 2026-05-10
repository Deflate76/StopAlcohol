export function initSurvivalChart(targetChart) {
    if (targetChart) targetChart.destroy();
    const ctx = document.getElementById('survivalChart').getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: { datasets: [
            { label: '탈락 영역 (과거)', data: [], borderColor: '#e74c3c', backgroundColor: 'rgba(231, 76, 60, 0.4)', fill: true, pointRadius: 0, tension: 0.3 },
            { label: '생존 영역 (잠재)', data: [], borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.4)', fill: true, pointRadius: 0, tension: 0.3 }
        ]},
        options: { 
            responsive: true, maintainAspectRatio: false, 
            scales: { x: { type: 'linear', min: 0, max: 100, title: { display:true, text:'경과일수', font:{size:10} } }, y: { beginAtZero: true, max: 1000, title: { display:true, text:'생존자수', font:{size:10} } } }, 
            plugins: { 
                legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' }, padding: 15 } }, 
                annotation: { 
                    annotations: { 
                        line1: { type: 'line', xMin: 0, xMax: 0, borderColor: '#2d3748', borderWidth: 2, borderDash: [4, 4], label: { display: true, content: '현재 경과', position: 'center', rotation: 90, backgroundColor: '#2d3748', color: '#fff', font: { size: 10 }, padding: { top: 4, bottom: 4, left: 6, right: 6 }, borderRadius: 4 } },
                        line2: { type: 'line', yMin: 0, yMax: 0, borderColor: '#e74c3c', borderWidth: 1.5, borderDash: [4, 4], label: { display: true, content: '생존', position: 'start', backgroundColor: '#e74c3c', font: { size: 10 } } },
                        line3: { type: 'line', xMin: 0, xMax: 0, borderColor: '#f39c12', borderWidth: 1.5, borderDash: [2, 2], label: { display: true, content: '최장 기록', position: 'center', backgroundColor: '#f39c12', font: { size: 10 } } }
                    } 
                } 
            } 
        }
    });
}

export function initDistributionChart(targetChart) {
    if (targetChart) targetChart.destroy();
    const ctx = document.getElementById('distributionChart').getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: { 
            datasets: [
                { label: '나의 여정 (좌측)', data: [], borderColor: '#e74c3c', backgroundColor: 'rgba(231, 76, 60, 0.4)', fill: true, pointRadius: 0, tension: 0.4 },
                { label: '미지의 영역 (우측)', data: [], borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.1)', fill: true, pointRadius: 0, tension: 0.4 }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            scales: { x: { type: 'linear', min: 0, max: 100, title: { display:true, text:'금주 일수', font:{size:10} } }, y: { display: false } }, 
            plugins: { 
                legend: { display: false }, 
                annotation: { 
                    annotations: { 
                        myPosition: { type: 'line', xMin: 0, xMax: 0, borderColor: '#e74c3c', borderWidth: 2, label: { display: true, content: '나의 위치', position: 'top', backgroundColor: '#e74c3c', font: { size: 10 } } },
                        maxPosition: { type: 'line', xMin: 0, xMax: 0, borderColor: '#f39c12', borderWidth: 2, borderDash: [2, 2], label: { display: true, content: '최장 기록', position: 'center', backgroundColor: '#f39c12', font: { size: 10 } } }
                    } 
                } 
            } 
        }
    });
}

export function updateChart(mainChart, distChart, days, survivors, globalMaxDays) {
    if (!mainChart) return;
    const past = []; const future = [];
    for (let i = 0; i <= days; i++) past.push({x: i, y: 1000 * Math.exp(-0.04 * i)});
    past.push({x: days, y: 1000 * Math.exp(-0.04 * days)});
    for (let i = Math.ceil(days); i <= 100; i++) future.push({x: i, y: 1000 * Math.exp(-0.04 * i)});
    
    mainChart.data.datasets[0].data = past;
    mainChart.data.datasets[1].data = future;

    mainChart.options.plugins.annotation.annotations.line1.xMin = days;
    mainChart.options.plugins.annotation.annotations.line1.xMax = days;
    mainChart.options.plugins.annotation.annotations.line2.yMin = survivors;
    mainChart.options.plugins.annotation.annotations.line2.yMax = survivors;
    mainChart.options.plugins.annotation.annotations.line2.label.content = survivors.toLocaleString() + '명';

    let isOverlapping = (Math.floor(days) >= globalMaxDays);

    if (globalMaxDays > 0 && !isOverlapping) {
        mainChart.options.plugins.annotation.annotations.line3.xMin = globalMaxDays;
        mainChart.options.plugins.annotation.annotations.line3.xMax = globalMaxDays;
        mainChart.options.plugins.annotation.annotations.line3.label.content = `최장 ${globalMaxDays}일`;
        mainChart.options.plugins.annotation.annotations.line3.display = true;
    } else if (mainChart.options.plugins.annotation.annotations.line3) {
        mainChart.options.plugins.annotation.annotations.line3.display = false;
    }

    mainChart.update('none');

    if (distChart) {
        const displayDays = Math.min(days, 100); 
        const distPast = []; const distFuture = [];
        for(let i = 0; i <= 100; i+=2) {
            const y = (1 / (i + 5)) * Math.exp(-Math.pow(Math.log((i+1)/15), 2) / (2 * Math.pow(0.8, 2))) * 1000;
            if (i <= displayDays) distPast.push({x: i, y: y});
            else distFuture.push({x: i, y: y});
        }
        const currentY = (1 / (displayDays + 5)) * Math.exp(-Math.pow(Math.log((displayDays+1)/15), 2) / (2 * Math.pow(0.8, 2))) * 1000;
        
        distPast.push({x: displayDays, y: currentY});
        distFuture.unshift({x: displayDays, y: currentY});

        distPast.sort((a,b)=>a.x - b.x);
        distFuture.sort((a,b)=>a.x - b.x);

        distChart.data.datasets[0].data = distPast; 
        distChart.data.datasets[1].data = distFuture; 

        distChart.options.plugins.annotation.annotations.myPosition.xMin = displayDays;
        distChart.options.plugins.annotation.annotations.myPosition.xMax = displayDays;
        
        if (globalMaxDays > 0 && !isOverlapping) {
            const displayMax = Math.min(globalMaxDays, 100);
            distChart.options.plugins.annotation.annotations.maxPosition.xMin = displayMax;
            distChart.options.plugins.annotation.annotations.maxPosition.xMax = displayMax;
            distChart.options.plugins.annotation.annotations.maxPosition.label.content = `최장 ${globalMaxDays}일`;
            distChart.options.plugins.annotation.annotations.maxPosition.display = true;
        } else if (distChart.options.plugins.annotation.annotations.maxPosition) {
            distChart.options.plugins.annotation.annotations.maxPosition.display = false;
        }
        distChart.update('none');
    }
}

export function renderChart(canvasId, targetChart, dataArray) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (targetChart) targetChart.destroy();
    
    const lastData = dataArray.slice(-20); 
    const customAnnotations = {};
    
    lastData.forEach((d, i) => {
        if (d.type === 'action') {
            customAnnotations['action' + i] = { type: 'line', xMin: i, xMax: i, yMin: 0, yMax: 10, borderColor: '#2ecc71', borderWidth: 2, borderDash: [4, 4], label: { display: true, content: '🛡️ ' + d.actionName, position: 'center', backgroundColor: '#2ecc71', color: '#fff', font: { size: 11, weight: 'bold' }, rotation: 90, padding: { top: 2, bottom: 2, left: 8, right: 8 }, borderRadius: 4 } };
        } else if (d.type === 'state') {
            customAnnotations['state' + i] = { type: 'line', xMin: i, xMax: i, yMin: 0, yMax: 10, borderColor: '#3498db', borderWidth: 2, borderDash: [2, 2], label: { display: true, content: '📝 상태 기록', position: 'center', backgroundColor: '#3498db', color: '#fff', font: { size: 11, weight: 'bold' }, rotation: 90, padding: { top: 2, bottom: 2, left: 8, right: 8 }, borderRadius: 4 } };
        } else if (d.type === 'eval') {
            customAnnotations['eval' + i] = { type: 'line', xMin: i, xMax: i, borderColor: '#27ae60', borderWidth: 2, borderDash: [2, 2], label: { display: true, content: '✓ 효과: ' + d.effect + '/10', position: 'start', backgroundColor: '#27ae60', font: { size: 10, weight: 'bold' }, yAdjust: 35, padding: { top: 2, bottom: 2, left: 6, right: 6 }, borderRadius: 4 } };
        } else if (d.type === 'medication') {
            customAnnotations['med' + i] = { type: 'line', xMin: i, xMax: i, yMin: 0, yMax: 10, borderColor: '#8e44ad', borderWidth: 2, borderDash: [2, 2], label: { display: true, content: '💊 ' + d.drugName, position: 'center', backgroundColor: '#8e44ad', color: '#fff', font: { size: 10, weight: 'bold' }, rotation: 90, padding: { top: 2, bottom: 2, left: 6, right: 6 }, borderRadius: 4 } };
        }
    });

    return new Chart(ctx, {
        type: 'bar',
        data: { 
            labels: lastData.map(d => d.date), 
            datasets: [
                { type: 'line', label: '🔥 갈망 강도', data: lastData.map(d => (d.type === 'action' || d.type === 'state' || d.type === 'medication') ? null : d.strength), borderColor: '#e74c3c', backgroundColor: '#e74c3c', borderWidth: 3, pointRadius: 5, tension: 0.3, spanGaps: true, order: 0 },
                { label: '육체 피로', data: lastData.map(d => (d.type === 'state' || !d.type || d.type === 'medication') && d.fatigue != null ? d.fatigue : null), backgroundColor: 'rgba(52, 152, 219, 0.5)', order: 1 },
                { label: '정신 스트레스', data: lastData.map(d => (d.type === 'state' || !d.type || d.type === 'medication') && d.stress != null ? d.stress : null), backgroundColor: 'rgba(243, 156, 18, 0.5)', order: 1 },
                { label: '수면 부족', data: lastData.map(d => (d.type === 'state' || !d.type || d.type === 'medication') && d.sleep != null ? d.sleep : null), backgroundColor: 'rgba(155, 89, 182, 0.5)', order: 1 },
                { label: '배고픔', data: lastData.map(d => (d.type === 'state' || !d.type || d.type === 'medication') && d.hunger != null ? d.hunger : null), backgroundColor: 'rgba(46, 204, 113, 0.5)', order: 1 }
            ] 
        },
        options: { 
            responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 10 } },
            plugins: { 
                legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
                annotation: { annotations: customAnnotations }, 
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            const d = lastData[context.dataIndex];
                            if (d.type === 'action') return `💡 행동 의의: ${d.actionDesc}`;
                            else if (d.type === 'state') {
                                let txt = [`금단: ${d.withdrawal ?? '-'}, 기분: ${d.mood ?? '-'}, 갈증: ${d.thirst ?? '-'}`];
                                if (d.fatigue != null || d.stress != null || d.sleep != null || d.hunger != null) {
                                    txt.push(`피로: ${d.fatigue ?? '-'}, 스트레스: ${d.stress ?? '-'}, 수면: ${d.sleep ?? '-'}, 허기: ${d.hunger ?? '-'}`);
                                }
                                return txt;
                            } else if (d.type === 'medication') return `💊 복용량: ${d.dose}mg`;
                            else if (d.type === 'eval') return `🛡️ 효과 점수: ${d.effect}/10`;
                            else if (context.datasetIndex === 0) {
                                if (d.reason) return `💡 고비 원인: ${d.reason}`;
                            }
                            return null;
                        }
                    }
                }
            } 
        }
    });
}

export function renderStateChart(canvasId, targetChart, stateData) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (targetChart) targetChart.destroy();
    
    const lastData = stateData.slice(-20); 
    
    return new Chart(ctx, {
        type: 'line',
        data: { 
            labels: lastData.map(d => d.date), 
            datasets: [
                { label: '금단증상', data: lastData.map(d => d.withdrawal !== undefined ? d.withdrawal : null), borderColor: '#e74c3c', backgroundColor: '#e74c3c', tension: 0.3, spanGaps: true },
                { label: '기분', data: lastData.map(d => d.mood !== undefined ? d.mood : null), borderColor: '#3498db', backgroundColor: '#3498db', tension: 0.3, spanGaps: true },
                { label: '갈증', data: lastData.map(d => d.thirst !== undefined ? d.thirst : null), borderColor: '#9b59b6', backgroundColor: '#9b59b6', tension: 0.3, spanGaps: true },
                { label: '피로', data: lastData.map(d => d.fatigue !== undefined ? d.fatigue : null), borderColor: '#f39c12', backgroundColor: '#f39c12', tension: 0.3, spanGaps: true },
                { label: '스트레스', data: lastData.map(d => d.stress !== undefined ? d.stress : null), borderColor: '#e67e22', backgroundColor: '#e67e22', tension: 0.3, spanGaps: true },
                { label: '수면(부족)', data: lastData.map(d => d.sleep !== undefined ? d.sleep : null), borderColor: '#34495e', backgroundColor: '#34495e', tension: 0.3, spanGaps: true },
                { label: '배고픔', data: lastData.map(d => d.hunger !== undefined ? d.hunger : null), borderColor: '#2ecc71', backgroundColor: '#2ecc71', tension: 0.3, spanGaps: true }
            ] 
        },
        options: { 
            responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 10 } },
            plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { mode: 'index', intersect: false } } 
        }
    });
}

export function plotMedicationGraph(targetChart, drug, dose, weight) {
    if (targetChart) targetChart.destroy();
    const ctx = document.getElementById('medChartCanvas').getContext('2d');
    
    const dataPoints = []; const labels = [];
    let Ka, Ke, Vd, colorStr, drugName;
    
    if (drug === 'acamprosate') {
        Ka = 0.5; Ke = 0.05; Vd = 1.0 * weight; colorStr = '#9b59b6'; drugName = '아캄프로세이트';
    } else {
        Ka = 1.0; Ke = 0.15; Vd = 13.0 * weight; colorStr = '#e74c3c'; drugName = '날트렉손';
    }

    for (let t = 0; t <= 24; t += 0.5) {
        let C = (dose * Ka) / (Vd * (Ka - Ke)) * (Math.exp(-Ke * t) - Math.exp(-Ka * t));
        if (C < 0) C = 0;
        labels.push(t + 'h');
        dataPoints.push(C.toFixed(3));
    }

    return new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: `${drugName} 혈중 추정 농도 (mg/L)`, data: dataPoints, borderColor: colorStr, backgroundColor: `${colorStr}33`, fill: true, tension: 0.4, pointRadius: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: '농도 (mg/L)' } }, x: { ticks: { maxTicksLimit: 12 }, title: { display: true, text: '복용 후 경과 시간' } } }, plugins: { legend: { display: false } } }
    });
}
