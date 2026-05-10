import { db, auth, googleProvider } from './config.js';
import { physicalStages, liverStages, brainStages } from './constants.js';
import { openModal, closeModal, toggleEtc, markTouched, updateRangeStyle, resetStateModal } from './ui.js';
import { initSurvivalChart, initDistributionChart, updateMainCharts, renderStatsChart, renderStateHistoryChart, plotMedication } from './charts.js';
import { doc, setDoc, getDoc, updateDoc, arrayUnion, deleteDoc, collection, addDoc, query, orderBy, limit, onSnapshot, getDocs, where } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";

// --- 전역 상태 관리 ---
let userId = null; 
let userProfile = { gender: 'male', weight: 70, height: 170 };
let currentChallengeId = null; 
let userQuitDate = null; 
let cravingData = [];
let timerInterval = null;
let currentTabName = 'physical';
let unsubscribePosts = null; 
let totalPastDays = 0;
let globalMaxDays = 0;
let globalBestStartDate = null; 
let editingChallengeId = null;
let evalPromptedFor = null;
let allChallengesData = []; 
let currentCalDate = new Date();
let currentCalMode = 'current';

// --- 초기화 로직 ---
window.onload = function() {
    renderChangeCards(currentTabName);
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('dateTimeInput').value = now.toISOString().slice(0, 16);
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        userId = user.uid;
        document.getElementById('loginArea').style.display = 'none';
        document.querySelectorAll('.user-display-name').forEach(el => { 
            el.innerText = `${user.displayName || '도전자'}님 환영합니다!`; 
        });
        
        try {
            const userDoc = await getDoc(doc(db, "users", userId));
            if (userDoc.exists() && userDoc.data().weight) {
                userProfile = { ...userProfile, ...userDoc.data() };
            }

            const q = query(collection(db, "users", userId, "challenges"), where("status", "==", "active"));
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                const activeDoc = snapshot.docs[0];
                currentChallengeId = activeDoc.id;
                const data = activeDoc.data();
                userQuitDate = data.startDate;
                cravingData = data.cravings || [];
                
                const actualCravings = cravingData.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length;
                document.getElementById('cravingCount').innerText = actualCravings;
                startApp(userQuitDate);
            } else {
                document.getElementById('setupArea').style.display = 'flex';
            }
            loadMotivationalStats();
        } catch (e) { 
            console.error("데이터 로드 에러:", e); 
        }
    } else {
        userId = null; 
        userQuitDate = null; 
        currentChallengeId = null;
        if (timerInterval) clearInterval(timerInterval);
        document.getElementById('loginArea').style.display = 'flex';
        document.getElementById('setupArea').style.display = 'none';
        document.getElementById('displayArea').style.display = 'none';
    }
});

// --- 데이터 로딩 및 UI 렌더링 함수 ---
async function loadMotivationalStats() {
    if (!userId) return;
    try {
        const q = query(collection(db, "users", userId, "challenges"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            document.getElementById('motivationalSummary').style.display = 'none';
            document.getElementById('activeMotivationalSummary').style.display = 'none';
            allChallengesData = [];
            return;
        }

        let totalDays = 0, maxDays = 0, bestStartDate = null, totalCravings = 0, challengeCount = 0;
        totalPastDays = 0; 
        allChallengesData = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const start = new Date(data.startDate);
            const end = data.endDate ? new Date(data.endDate) : new Date();
            const diffDays = Math.max(0, Math.floor((end - start) / 86400000));
            
            allChallengesData.push({ 
                startDate: start, 
                endDate: end, 
                status: data.status, 
                failReason: data.failReason 
            });
            
            totalDays += diffDays;
            if (docSnap.id !== currentChallengeId) totalPastDays += diffDays;
            if (diffDays > maxDays) { 
                maxDays = diffDays; 
                bestStartDate = data.startDate; 
            }
            if (data.cravings) {
                totalCravings += data.cravings.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length;
            }
            challengeCount++;
        });

        globalMaxDays = maxDays; 
        globalBestStartDate = bestStartDate;

        if (challengeCount > 0 && totalDays > 0) {
            const htmlContent = `
                <div style="background: linear-gradient(135deg, #f0f7ff, #ffffff); border: 1px solid #cbe3fa; border-radius: 18px; padding: 20px; text-align: left; box-shadow: 0 4px 10px rgba(52, 152, 219, 0.1);">
                    <h3 style="margin-top: 0; margin-bottom: 10px; color: var(--primary-color); font-size: 1.15rem; display: flex; align-items: center; gap: 8px;"><span>🌱</span> 당신의 노력은 사라지지 않았습니다</h3>
                    <p style="font-size: 0.85rem; color: #4a5568; line-height: 1.5; margin-bottom: 18px; word-break: keep-all;">지금까지 간과 뇌가 회복할 수 있도록 스스로에게 선물한 시간들은 고스란히 <b>단주 내공</b>으로 당신의 몸에 축적되어 있습니다.</p>
                    <div style="display: flex; gap: 10px; text-align: center;">
                        <div style="flex: 1; background: #fff; padding: 12px 5px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                            <div style="font-size: 0.75rem; color: #718096; font-weight: 700;">내 인생 누적 단주</div><div class="dynamic-total-days" style="font-size: 1.1rem; font-weight: 800; color: var(--primary-color); margin-top: 2px;">${totalDays}일</div>
                        </div>
                        <div style="flex: 1; background: #fff; padding: 12px 5px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                            <div style="font-size: 0.75rem; color: #718096; font-weight: 700;">최장 생존 기록</div><div class="dynamic-max-days" style="font-size: 1.1rem; font-weight: 800; color: var(--success-color); margin-top: 2px;">${maxDays}일</div>
                        </div>
                        <div style="flex: 1; background: #fff; padding: 12px 5px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                            <div style="font-size: 0.75rem; color: #718096; font-weight: 700;">이겨냈던 고비</div><div style="font-size: 1.1rem; font-weight: 800; color: var(--warning-color); margin-top: 2px;">${totalCravings}번</div>
                        </div>
                    </div>
                </div>`;
            document.getElementById('motivationalSummary').innerHTML = htmlContent;
            document.getElementById('motivationalSummary').style.display = 'block';
            document.getElementById('activeMotivationalSummary').innerHTML = htmlContent;
            document.getElementById('activeMotivationalSummary').style.display = 'block';
        } else {
            document.getElementById('motivationalSummary').style.display = 'none';
            document.getElementById('activeMotivationalSummary').style.display = 'none';
        }
    } catch(e) { 
        console.error(e); 
    }
}

function renderCalendar(year, month, mode) {
    document.getElementById('calMonthTitle').innerText = `${year}년 ${month + 1}월`;
    const legendContainer = document.getElementById('calLegendContainer');
    
    if (mode === 'current') {
        legendContainer.innerHTML = `<div><span style="display:inline-block; width:10px; height:10px; background:var(--primary-color); border-radius:2px;"></span> 현재 기록</div>`;
    } else {
        legendContainer.innerHTML = `
            <div><span style="display:inline-block; width:10px; height:10px; background:var(--success-color); border-radius:2px;"></span> 과거 성공구간</div>
            <div><span style="display:inline-block; width:10px; height:10px; background:white; border:1px solid #ddd; position:relative; border-radius:2px;"><span style="position:absolute; font-size:6px; top:-2px; left:-1px;">❌</span></span> 실패한 날</div>`;
    }

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const grid = document.getElementById('calendarDaysGrid');
    grid.innerHTML = '';

    for (let i = 0; i < firstDay; i++) {
        grid.innerHTML += `<div class="cal-day empty"></div>`;
    }

    const today = new Date(); 
    today.setHours(0,0,0,0);

    for (let day = 1; day <= daysInMonth; day++) {
        const iterDate = new Date(year, month, day); 
        iterDate.setHours(0,0,0,0);
        const iterTime = iterDate.getTime();
        const dayOfWeek = iterDate.getDay();
        let classList = ['cal-day'];
        
        if (dayOfWeek === 0) classList.push('sun');
        if (dayOfWeek === 6) classList.push('sat');
        if (iterTime === today.getTime()) classList.push('today-mark');

        if (mode === 'current' && userQuitDate) {
            const sDate = new Date(userQuitDate); sDate.setHours(0,0,0,0);
            const eDate = new Date(); eDate.setHours(0,0,0,0);
            const isStart = iterTime === sDate.getTime();
            const isEnd = iterTime === eDate.getTime();
            
            if (iterTime >= sDate.getTime() && iterTime <= eDate.getTime()) {
                if (isStart && isEnd) classList.push('range-curr-single');
                else if (isStart) classList.push('range-curr-start');
                else if (isEnd) classList.push('range-curr-end');
                else classList.push('range-curr-mid');
            }
        } else if (mode === 'accumulated') {
            allChallengesData.forEach(c => {
                const sd = new Date(c.startDate); sd.setHours(0,0,0,0);
                const ed = new Date(c.endDate); ed.setHours(0,0,0,0);
                const isStart = iterTime === sd.getTime();
                const isEnd = iterTime === ed.getTime();
                
                if (iterTime >= sd.getTime() && iterTime <= ed.getTime()) {
                    if (isStart && isEnd) classList.push('range-acc-single');
                    else if (isStart) classList.push('range-acc-start');
                    else if (isEnd) classList.push('range-acc-end');
                    else classList.push('range-acc-mid');
                }
                if (c.status === 'failed' && isEnd) classList.push('fail-mark');
            });
        }
        grid.innerHTML += `<div class="${classList.join(' ')}">${day}</div>`;
    }
}

function startApp(startISO) {
    localStorage.setItem('quitDrinkingDateTime_server', startISO);
    document.getElementById('setupArea').style.display = 'none';
    document.getElementById('displayArea').style.display = 'block';
    
    const d = new Date(startISO);
    document.getElementById('displaySettingDate').innerText = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시 ${d.getMinutes()}분`;

    initSurvivalChart();
    initDistributionChart(); 
    renderChangeCards(currentTabName);

    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        const start = new Date(startISO); 
        const now = new Date(); 
        const diff = now - start;
        
        if (diff < 0) return;

        const days = diff / 86400000;
        const hours = Math.floor((diff/3600000)%24);
        const minutes = Math.floor((diff/60000)%60);
        const seconds = Math.floor((diff/1000)%60);
        const currentDays = Math.floor(days);
        const totalCumul = totalPastDays + currentDays;
        let currentMax = Math.max(globalMaxDays, currentDays);

        document.getElementById('mainDaysContainer').innerHTML = `
            <div class="cal-hint">👇 클릭하여 달력 보기</div>
            <div class="clickable-time-box" onclick="openCalendarModal('current')"><div class="time-unit">${currentDays}일</div></div>
            <div class="clickable-time-box" onclick="openCalendarModal('accumulated')" style="margin-top: -10px; padding: 5px 15px;"><span class="sub-time-clickable">(누적 ${totalCumul}일 보기)</span></div>
        `;
        
        document.querySelectorAll('.dynamic-total-days').forEach(el => el.innerText = `${totalCumul}일`);
        document.querySelectorAll('.dynamic-max-days').forEach(el => el.innerText = `${currentMax}일`);
        document.getElementById('subTime').innerText = `${hours}시간 ${minutes}분 ${seconds}초`;
        
        const nowH = now.getHours();
        const nowM = now.getMinutes();
        const nowS = now.getSeconds();
        const dailyProgress = ((nowH * 3600 + nowM * 60 + nowS) / 86400) * 100;
        
        document.getElementById('subFill').style.width = dailyProgress + '%';
        document.getElementById('subPercent').innerText = `오늘 하루 진행도: ${nowH}시간 ${nowM}분 경과`;

        const survivors = Math.max(1, Math.round(1000 * Math.exp(-0.04 * days)));
        const yesterdaySurvivors = Math.max(1, Math.round(1000 * Math.exp(-0.04 * Math.max(0, days - 1))));
        const rankUp = yesterdaySurvivors - survivors;

        document.getElementById('survivors').innerText = survivors.toLocaleString();
        document.getElementById('myRank').innerText = survivors.toLocaleString();
        
        const rankChangeEl = document.getElementById('rankChange');
        if (rankUp > 0) {
            rankChangeEl.innerHTML = `<span style="color: var(--danger-color);">▲ ${rankUp.toLocaleString()}</span>`;
        } else {
            rankChangeEl.innerHTML = `<span style="color: #a0aec0;">-</span>`;
        }
        
        if (currentMax > 0) {
            const bestRank = Math.max(1, Math.round(1000 * Math.exp(-0.04 * currentMax)));
            document.getElementById('myBestRank').innerText = bestRank.toLocaleString();
            let targetStartDateStr = (currentDays >= globalMaxDays) ? startISO : globalBestStartDate;
            if (targetStartDateStr) {
                const bDate = new Date(targetStartDateStr);
                document.getElementById('myBestRankDate').innerText = `(${bDate.getFullYear().toString().slice(2)}.${String(bDate.getMonth()+1).padStart(2,'0')}.${String(bDate.getDate()).padStart(2,'0')} 시작)`;
            }
        } else {
            document.getElementById('myBestRank').innerText = '-';
            document.getElementById('myBestRankDate').innerText = '';
        }

        updateMainCharts(days, survivors, globalMaxDays, startISO, globalBestStartDate);
        if(currentTabName !== 'community') updateRoadmap(days); 

        // Eval Prompting
        if (cravingData.length > 0) {
            const filteredActs = cravingData.filter(d => d.type === 'action');
            if (filteredActs.length > 0) {
                const lastEntry = filteredActs[filteredActs.length - 1];
                const hasEval = cravingData.some(d => d.type === 'eval' && d.timestamp > lastEntry.timestamp);
                
                if (!hasEval && evalPromptedFor !== lastEntry.timestamp) {
                    const diffMs = new Date().getTime() - lastEntry.timestamp;
                    if (diffMs > 3 * 60 * 1000) {
                        evalPromptedFor = lastEntry.timestamp;
                        const timeStr = new Date(lastEntry.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                        document.getElementById('evalMessage').innerHTML = `최근 <b>[${lastEntry.actionName}]</b> 행동을 실천한 지 <b>${Math.floor(diffMs / 60000)}분</b> 지났습니다.<br><span style="font-size:0.8rem; color:#999;">(실천 시각: ${timeStr})</span><br><br>효과가 있었는지, 현재 갈망은 어떤지 평가해주세요.`;
                        openModal('evalModal');
                    }
                }
            }
        }
    }, 1000);
}

function renderChangeCards(tabName) {
    let activeStages = physicalStages;
    if(tabName === 'liver') activeStages = liverStages;
    if(tabName === 'brain') activeStages = brainStages;
    
    const savedDate = localStorage.getItem('quitDrinkingDateTime_server');
    const currentDays = savedDate ? Math.max(0, (new Date() - new Date(savedDate)) / 86400000) : 0;

    let achievedCards = '';
    let upcomingCards = '';
    let achievedCount = 0;

    activeStages.forEach((s, i) => {
        const perc = Math.min((currentDays / s.d) * 100, 100);
        const isActive = perc >= 100;
        const cardHTML = `
            <div class="change-card ${isActive ? 'active' : ''}" id="card${i}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:700; font-size:0.95rem;">${s.t}</span>
                    <div class="progress-bg">
                        <span class="progress-text" id="text${i}">${Math.floor(perc)}%</span>
                        <div class="progress-fill" id="fill${i}" style="width: ${perc}%"></div>
                    </div>
                </div>
                <p style="font-size:0.85rem; color:#666; margin-top:6px;">${s.desc}</p>
            </div>`;
            
        if (isActive) { 
            achievedCards += cardHTML; 
            achievedCount++; 
        } else { 
            upcomingCards += cardHTML; 
        }
    });

    let finalHTML = '';
    if (achievedCount > 0) {
        finalHTML += `<details class="achieved-details"><summary>✅ 달성 완료한 변화 (${achievedCount})</summary><div class="details-content">${achievedCards}</div></details>`;
    }
    if (upcomingCards) {
        finalHTML += `<details class="upcoming-details"><summary>🚀 진행 중 및 다음 목표 (${activeStages.length - achievedCount})</summary><div class="details-content">${upcomingCards}</div></details>`;
    }
    if (achievedCount === activeStages.length) {
        finalHTML += `<div style="text-align: center; padding: 20px; color: var(--success-color); font-weight: bold; background: #f0fff4; border-radius: 14px; margin-top: 10px;">🎉 모든 변화를 성공적으로 달성했습니다! 🎉</div>`;
    }
    
    document.getElementById('changeList').innerHTML = finalHTML;
}

function updateRoadmap(days) {
    let activeStages = physicalStages;
    if(currentTabName === 'liver') activeStages = liverStages;
    if(currentTabName === 'brain') activeStages = brainStages;

    activeStages.forEach((s, i) => {
        const perc = Math.min((days / s.d) * 100, 100);
        const fill = document.getElementById(`fill${i}`);
        const text = document.getElementById(`text${i}`);
        const card = document.getElementById(`card${i}`);
        
        if (fill) fill.style.width = perc + '%';
        if (text) text.innerText = Math.floor(perc) + '%';
        if (card) { 
            if (perc >= 100) card.classList.add('active'); 
            else card.classList.remove('active'); 
        }
    });
}

function calcDday(quitISO) {
    if(!quitISO) return "?";
    const diff = new Date() - new Date(quitISO);
    return diff < 0 ? "0" : Math.floor(diff / 86400000) + 1;
}


// ============================================================================
// Window 전역 함수 매핑 (HTML 인라인 이벤트용)
// ============================================================================

window.loginWithGoogle = async () => { 
    try { 
        await signInWithPopup(auth, googleProvider); 
    } catch (error) { 
        alert(`로그인 실패!\n에러 메시지: ${error.message}`); 
    } 
};

window.logout = async () => { 
    try { 
        await signOut(auth); 
        localStorage.removeItem('quitDrinkingDateTime_server'); 
    } catch (error) { 
        alert("로그아웃 실패"); 
    } 
};

window.goToControlMode = async () => {
    if (!userId) return alert("음주 조절 모드를 사용하려면 로그인이 필요합니다.");
    if (currentChallengeId && confirm("정말 현재 단주 도전을 종료하고 음주 조절 모드로 전환하시겠습니까?\n(현재 도전 기록은 '실패'로 저장됩니다.)")) {
        try {
            await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { 
                status: 'failed', 
                endDate: new Date().toISOString(), 
                failReason: '음주 조절 모드로 자발적 전환' 
            });
            localStorage.removeItem('quitDrinkingDateTime_server'); 
            window.location.href = 'control.html';
        } catch (e) { 
            alert("도전 종료 처리 중 에러가 발생했습니다: " + e.message); 
        }
    } else if (!currentChallengeId) { 
        window.location.href = 'control.html'; 
    }
};

window.switchTab = (btn, tabName) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); 
    currentTabName = tabName;
    
    const changeSection = document.getElementById('changeSection');
    const communitySection = document.getElementById('communitySection');

    if (tabName === 'community') {
        changeSection.style.display = 'none'; 
        communitySection.style.display = 'block'; 
        window.loadPosts(); 
    } else {
        changeSection.style.display = 'block'; 
        communitySection.style.display = 'none'; 
        renderChangeCards(tabName);
        if (unsubscribePosts) unsubscribePosts(); 
    }
    
    const savedDate = localStorage.getItem('quitDrinkingDateTime_server');
    if(savedDate && tabName !== 'community') {
        updateRoadmap((new Date() - new Date(savedDate)) / 86400000);
    }
};

window.submitPost = async () => {
    if (!userId) return alert("로그인이 필요합니다.");
    const content = document.getElementById('postContent').value.trim();
    if (!content) return alert("내용을 입력해 주세요.");
    
    try {
        await addDoc(collection(db, "posts"), { 
            uid: userId, 
            author: auth.currentUser.displayName || "익명의 생존자", 
            authorQuitDate: userQuitDate || null, 
            content: content, 
            createdAt: new Date().getTime(), 
            comments: [] 
        });
        document.getElementById('postContent').value = '';
    } catch (error) { 
        alert("작성에 실패했습니다: " + error.message); 
    }
};

window.loadPosts = () => {
    unsubscribePosts = onSnapshot(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50)), (snapshot) => {
        const postList = document.getElementById('postList'); 
        postList.innerHTML = ''; 
        
        if (snapshot.empty) {
            postList.innerHTML = '<div style="text-align:center; padding:20px; color:#999; font-size:0.9rem;">아직 발송된 통신이 없습니다.<br>첫 생존 신고를 남겨보세요!</div>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const id = docSnap.id;
            const data = docSnap.data();
            const dateStr = new Date(data.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const dayBadge = `<span class="day-badge">D+${calcDday(data.authorQuitDate)}</span>`;
            const isMe = data.uid === userId;
            const authorText = isMe ? `${data.author} <span style="color:var(--primary-color);">(나)</span>` : data.author;
            const encodedContent = encodeURIComponent(data.content);
            const actionHTML = isMe ? `<div class="post-actions"><button class="action-btn" onclick="editPost('${id}', '${encodedContent}')">수정</button><button class="action-btn" style="color:var(--danger-color);" onclick="deletePost('${id}')">삭제</button></div>` : '';
            
            let commentsHTML = (data.comments || []).map((c, cIdx) => `
                <div class="comment-item">
                    <strong style="color:#2d3748">${c.author}</strong>
                    <span class="day-badge" style="font-size:0.65rem; padding:1px 4px;">D+${calcDday(c.authorQuitDate)}</span>
                    <span style="margin-left:5px; color:#4a5568;">${c.text}</span>
                    ${c.uid === userId ? `<button class="action-btn" style="font-size:0.75rem; color:var(--danger-color); margin-left:8px;" onclick="deleteComment('${id}', ${cIdx})">지우기</button>` : ''}
                </div>`).join('');

            postList.insertAdjacentHTML('beforeend', `
                <div class="post-card" style="${isMe ? 'border-left: 4px solid var(--primary-color);' : ''}">
                    <div class="post-header">
                        <div><span class="post-author">${authorText}</span>${dayBadge}</div>
                        <span class="post-date">${dateStr}</span>
                    </div>
                    <div class="post-body">
                        ${data.content.replace(/\n/g, '<br>')}
                        ${data.editedAt ? '<span style="font-size:0.75rem; color:#a0aec0;"> (수정됨)</span>' : ''}
                    </div>
                    ${actionHTML}
                    <div class="comment-section">
                        ${commentsHTML}
                        <div class="comment-input-area">
                            <input type="text" id="cmtInput_${id}" class="comment-input" placeholder="응원의 댓글 달기...">
                            <button class="comment-btn" onclick="addComment('${id}')">등록</button>
                        </div>
                    </div>
                </div>`);
        });
    });
};

window.editPost = async (postId, encodedContent) => {
    const newContent = prompt("내용을 수정하세요:", decodeURIComponent(encodedContent));
    if(newContent && newContent.trim()) { 
        try { 
            await updateDoc(doc(db, "posts", postId), { content: newContent.trim(), editedAt: new Date().getTime() }); 
        } catch(e) { 
            alert("수정 실패: " + e.message); 
        } 
    }
};

window.deletePost = async (postId) => { 
    if(confirm("정말 이 통신을 삭제하시겠습니까?")) { 
        try { 
            await deleteDoc(doc(db, "posts", postId)); 
        } catch(e) { 
            alert("삭제 실패: " + e.message); 
        } 
    } 
};

window.addComment = async (postId) => {
    if (!userId) return alert("로그인이 필요합니다.");
    const inputEl = document.getElementById(`cmtInput_${postId}`);
    const text = inputEl.value.trim();
    if(!text) return;
    
    try {
        await updateDoc(doc(db, "posts", postId), { 
            comments: arrayUnion({ 
                uid: userId, 
                author: auth.currentUser.displayName || "익명의 생존자", 
                authorQuitDate: userQuitDate || null, 
                text: text, 
                createdAt: new Date().getTime() 
            }) 
        });
        inputEl.value = '';
    } catch(e) { 
        alert("댓글 등록 실패: " + e.message); 
    }
};

window.deleteComment = async (postId, commentIndex) => {
    if(confirm("댓글을 삭제하시겠습니까?")) {
        try {
            const postRef = doc(db, "posts", postId);
            const postSnap = await getDoc(postRef);
            if(postSnap.exists()) {
                let newComments = [...(postSnap.data().comments || [])]; 
                newComments.splice(commentIndex, 1);
                await updateDoc(postRef, { comments: newComments });
            }
        } catch(e) { 
            alert("댓글 삭제 실패: " + e.message); 
        }
    }
};

window.deleteHistory = async (event, historyDocId) => {
    event.stopPropagation();
    if (confirm("정말 이 단주 기록을 완전히 삭제하시겠습니까?\n(삭제된 데이터는 복구할 수 없습니다)")) {
        try {
            await deleteDoc(doc(db, "users", userId, "challenges", historyDocId));
            if (historyDocId === currentChallengeId) {
                localStorage.removeItem('quitDrinkingDateTime_server'); 
                currentChallengeId = null; 
                cravingData = []; 
                userQuitDate = null;
                if (timerInterval) clearInterval(timerInterval);
                document.getElementById('setupArea').style.display = 'flex'; 
                document.getElementById('displayArea').style.display = 'none'; 
                closeModal('historyListModal');
            } else { 
                window.openHistoryList(); 
            }
            loadMotivationalStats();
        } catch(e) { 
            alert("삭제 실패: " + e.message); 
        }
    }
};

window.openEditTimeModal = (event, historyDocId, currentStartDate) => {
    event.stopPropagation(); 
    editingChallengeId = historyDocId;
    const d = new Date(currentStartDate); 
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('editDateTimeInput').value = d.toISOString().slice(0, 16);
    openModal('editTimeModal');
};

window.saveEditedTime = async () => {
    if (!userId || !editingChallengeId) return;
    const newDate = document.getElementById('editDateTimeInput').value;
    if (!newDate) return alert("일시를 선택해 주세요.");
    
    try {
        await updateDoc(doc(db, "users", userId, "challenges", editingChallengeId), { startDate: newDate });
        if (editingChallengeId === currentChallengeId) { 
            userQuitDate = newDate; 
            startApp(newDate); 
        }
        alert("시작 시간이 성공적으로 수정되었습니다."); 
        closeModal('editTimeModal'); 
        window.openHistoryList(); 
        loadMotivationalStats();
    } catch (e) { 
        alert("수정 실패: " + e.message); 
    }
};

window.openEditReasonModal = (event, historyDocId, encStart, encFail) => {
    event.stopPropagation(); 
    editingChallengeId = historyDocId;
    const s = decodeURIComponent(encStart);
    const f = decodeURIComponent(encFail);
    document.getElementById('editStartReasonInput').value = (s && s !== 'undefined') ? s : '';
    document.getElementById('editFailReasonInput').value = (f && f !== 'undefined') ? f : '';
    openModal('editReasonModal');
};

window.saveEditedReasons = async () => {
    if (!userId || !editingChallengeId) return;
    try {
        await updateDoc(doc(db, "users", userId, "challenges", editingChallengeId), { 
            startReason: document.getElementById('editStartReasonInput').value.trim(), 
            failReason: document.getElementById('editFailReasonInput').value.trim() 
        });
        alert("사유가 성공적으로 반영되었습니다."); 
        closeModal('editReasonModal'); 
        window.openHistoryList(); 
    } catch (e) { 
        alert("수정 실패: " + e.message); 
    }
};

window.openHistoryList = async () => {
    if (!userId) return alert("로그인이 필요합니다.");
    closeModal('historyDetailModal'); 
    openModal('historyListModal');
    
    const container = document.getElementById('historyListContainer'); 
    container.innerHTML = '<div style="text-align:center; padding:20px;">기록을 불러오는 중입니다...</div>';
    
    try {
        const snapshot = await getDocs(query(collection(db, "users", userId, "challenges"), orderBy("createdAt", "desc")));
        if (snapshot.empty) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">아직 생성된 단주 도전 기록이 없습니다.</div>';
            return;
        }
        
        container.innerHTML = '';
        const docs = snapshot.docs;
        
        for (let i = 0; i < docs.length; i++) {
            const data = docs[i].data();
            const id = docs[i].id;
            const startStr = new Date(data.startDate).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            const endStr = data.endDate ? new Date(data.endDate).toLocaleDateString('ko-KR') : '';
            const diffDays = Math.max(0, Math.floor(( (data.endDate ? new Date(data.endDate) : new Date()) - new Date(data.startDate)) / 86400000));
            const cravCount = data.cravings ? data.cravings.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length : 0;
            const encodedData = encodeURIComponent(JSON.stringify(data));
            
            const startReasonText = data.startReason ? `<div style="margin-top:8px; font-size:0.8rem; color:#2c3e50; text-align:left;">🌱 <b>시작 각오:</b><br>${data.startReason.replace(/\n/g, '<br>')}</div>` : '';
            const failReasonText = data.failReason ? `<div style="margin-top:6px; font-size:0.8rem; color:#e74c3c; text-align:left;">🥀 <b>중단 사유:</b><br>${data.failReason.replace(/\n/g, '<br>')}</div>` : '';
            const statusBadge = data.status === 'active' ? `<span class="history-status status-active">도전 중</span>` : `<span class="history-status status-failed">종료됨</span>`;
            const reasonEditBtn = `<button class="action-btn" style="font-size:0.8rem; padding:4px 8px; background-color:#e2e8f0; color:#4a5568; border-radius:6px; font-weight:bold; margin-right: 6px;" onclick="openEditReasonModal(event, '${id}', '${encodeURIComponent(data.startReason||'')}', '${encodeURIComponent(data.failReason||'')}')">📝 사유수정</button>`;
            const actionBtn = data.status === 'active' 
                ? `<button class="action-btn" style="font-size:0.8rem; padding:4px 8px; background-color:#e2e8f0; color:#4a5568; border-radius:6px; font-weight:bold;" onclick="openEditTimeModal(event, '${id}', '${data.startDate}')">⚙️ 시간수정</button>` 
                : `<button class="action-btn" style="font-size:0.8rem; padding:4px 10px; background-color:var(--primary-color); color:white; border-radius:6px; font-weight:bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" onclick="resumeHistory(event, '${id}')">🔄 이어하기</button>`;

            container.insertAdjacentHTML('beforeend', `
                <div class="history-item" onclick="openHistoryDetail('${encodedData}')">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong style="color:var(--text-dark); font-size:0.9rem;">${startStr} ${data.status === 'active' ? '' : '~ ' + endStr}</strong>
                        <button class="action-btn" style="color:var(--danger-color); font-size:1.3rem; padding:0; line-height:1;" onclick="deleteHistory(event, '${id}')" title="삭제">&times;</button>
                    </div>
                    <div style="font-size:0.85rem; color:#666; text-align:left; margin-top:4px;">지속 기간: <b>${diffDays}일</b> | 넘긴 고비: <b>${cravCount}회</b></div>
                    ${startReasonText}${failReasonText}
                    <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #cbd5e0; display: flex; justify-content: space-between; align-items: center;">
                        ${statusBadge}
                        <div>${reasonEditBtn}${actionBtn}</div>
                    </div>
                </div>`);

            if (i < docs.length - 1) {
                const prevData = docs[i + 1].data();
                if (prevData.endDate) {
                    const gapMs = new Date(data.startDate).getTime() - new Date(prevData.endDate).getTime();
                    if (gapMs > 0) {
                        const gapDays = Math.floor(gapMs / 86400000);
                        const gapHours = Math.floor((gapMs / 3600000) % 24);
                        const gapMinutes = Math.floor((gapMs / 60000) % 60);
                        let gapText = [];
                        
                        if (gapDays > 0) gapText.push(`${gapDays}일`); 
                        if (gapHours > 0) gapText.push(`${gapHours}시간`); 
                        if (gapMinutes > 0) gapText.push(`${gapMinutes}분`);
                        if (gapText.length === 0) gapText.push("1분 미만");
                        
                        container.insertAdjacentHTML('beforeend', `<div class="history-gap"><span class="gap-days">${gapText.join(' ')}</span> 간의 음주 및 재정비 기간</div>`);
                    }
                }
            }
        }
    } catch (e) { 
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--danger-color);">기록을 불러오는데 실패했습니다.</div>'; 
    }
};

window.resumeHistory = async (event, historyDocId) => {
    event.stopPropagation(); 
    if (!userId) return;
    
    if (confirm("정말 이 단주 기록을 다시 이어서 진행하시겠습니까?\n(현재 진행 중인 새로운 도전이 있다면 자동으로 종료 처리됩니다.)")) {
        try {
            if (currentChallengeId && currentChallengeId !== historyDocId) {
                await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { 
                    status: 'failed', 
                    endDate: new Date().toISOString(), 
                    failReason: '과거 기록 이어하기로 전환' 
                });
            }
            
            await updateDoc(doc(db, "users", userId, "challenges", historyDocId), { 
                status: 'active', 
                endDate: null, 
                failReason: null 
            });
            
            currentChallengeId = historyDocId;
            const targetSnap = await getDoc(doc(db, "users", userId, "challenges", historyDocId));
            
            if (targetSnap.exists()) {
                const data = targetSnap.data(); 
                userQuitDate = data.startDate; 
                cravingData = data.cravings || [];
                document.getElementById('cravingCount').innerText = cravingData.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length;
            }
            
            closeModal('historyListModal'); 
            alert("선택한 단주 기록을 성공적으로 복구하여 이어서 진행합니다!");
            startApp(userQuitDate); 
            loadMotivationalStats();
        } catch (e) { 
            alert("기록 이어하기에 실패했습니다: " + e.message); 
        }
    }
};

window.openHistoryDetail = (encodedData) => {
    closeModal('historyListModal'); 
    openModal('historyDetailModal');
    
    const data = JSON.parse(decodeURIComponent(encodedData));
    const cravCount = data.cravings ? data.cravings.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length : 0;
    
    document.getElementById('historyDetailTitle').innerText = `${new Date(data.startDate).toLocaleDateString('ko-KR')} 도전 기록`;
    
    let summaryHtml = `총 <b>${cravCount}번</b>의 고비가 있었습니다.`;
    if (data.startReason) summaryHtml += `<br><div style="color:#2c3e50; font-size:0.8rem; margin-top:6px;">🌱 시작 각오:<br>${data.startReason.replace(/\n/g, '<br>')}</div>`;
    if (data.failReason) summaryHtml += `<br><div style="color:#e74c3c; font-size:0.8rem; margin-top:6px;">🥀 중단 사유:<br>${data.failReason.replace(/\n/g, '<br>')}</div>`;
    document.getElementById('historyDetailSummary').innerHTML = summaryHtml;

    setTimeout(() => {
        if (cravCount === 0 && (!data.cravings || data.cravings.length === 0)) {
            document.getElementById('pastCravingHistoryChart').parentElement.innerHTML = '<div style="text-align:center; padding-top:100px; color:#999;">이 기간에 기록된 고비 데이터가 없습니다.</div><canvas id="pastCravingHistoryChart" style="display:none;"></canvas>';
        } else {
            document.getElementById('pastCravingHistoryChart').parentElement.innerHTML = '<canvas id="pastCravingHistoryChart"></canvas>';
            renderStatsChart(data.cravings, true);
        }
    }, 200);
};

window.openMedListModal = () => {
    const medData = cravingData.filter(d => d.type === 'medication');
    const medContent = document.getElementById('medListContentModal');
    
    if (medData.length === 0) {
        medContent.innerHTML = '<div style="text-align:center; padding:20px; color:#999; font-size:0.9rem;">아직 기록된 약물 복용 내역이 없습니다.</div>';
    } else {
        medContent.innerHTML = medData.slice().reverse().map(m => `
            <div class="med-list-item" style="margin-bottom:8px;">
                <div>
                    <strong style="color: #8e44ad; font-size: 0.95rem;">💊 ${m.drugName}</strong>
                    <span style="color: #4a5568; margin-left: 6px;">${m.dose}mg</span>
                </div>
                <div style="color: #a0aec0; font-size: 0.8rem;">${m.date.split(' ').slice(3).join(' ')} 복용</div>
            </div>`).join('');
    }
    openModal('medListModal');
};

window.openStateStats = () => {
    const stateData = cravingData.filter(d => d.type === 'state');
    if (stateData.length === 0) return alert("현재 도전에 기록된 몸상태 데이터가 없습니다.");
    openModal('stateStatsModal'); 
    setTimeout(() => renderStateHistoryChart(stateData), 200);
};

window.openStats = () => {
    if (cravingData.length === 0) return alert("현재 도전에 기록된 데이터가 없습니다.");
    openModal('statsModal'); 
    setTimeout(() => renderStatsChart(cravingData, false), 200);
};

window.openBodyInfoModal = () => {
    document.getElementById('bodyGender').value = userProfile.gender || 'male';
    document.getElementById('bodyWeight').value = userProfile.weight || 70;
    document.getElementById('bodyHeight').value = userProfile.height || 175;
    openModal('bodyInfoModal');
};

window.saveBodyInfo = async () => {
    if (!userId) return alert("로그인이 필요합니다.");
    const gender = document.getElementById('bodyGender').value;
    const weight = parseFloat(document.getElementById('bodyWeight').value);
    const height = parseFloat(document.getElementById('bodyHeight').value);
    
    if (!weight || !height) return alert("체중과 신장을 올바르게 입력해주세요.");
    
    userProfile.gender = gender; 
    userProfile.weight = weight; 
    userProfile.height = height;
    
    try {
        await setDoc(doc(db, "users", userId), { gender, weight, height }, { merge: true });
        alert("신체 정보가 안전하게 저장되었습니다.\n약물 농도 및 음주 조절 BAC 계산에 활용됩니다."); 
        closeModal('bodyInfoModal');
    } catch(e) { 
        alert("저장 실패: " + e.message); 
    }
};

window.openMedModal = () => {
    if (!userProfile.weight) { 
        alert("정확한 혈중 농도 예측을 위해 먼저 신체계측 정보를 기록해주세요."); 
        return window.openBodyInfoModal(); 
    }
    document.getElementById('medDose').value = ''; 
    openModal('medModal');
};

window.submitMedication = async () => {
    if (!userId || !currentChallengeId) return;
    const drug = document.getElementById('medType').value;
    const dose = parseFloat(document.getElementById('medDose').value);
    const drugName = drug === 'acamprosate' ? '아캄프로세이트' : '날트렉손';
    
    if (!dose || dose <= 0) return alert("복용량을 올바르게 입력해주세요.");
    
    const entry = { 
        type: 'medication', 
        date: new Date().toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'numeric', minute:'numeric'}), 
        drug, 
        drugName, 
        dose, 
        timestamp: new Date().getTime() 
    };
    
    try {
        await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { cravings: arrayUnion(entry) });
        cravingData.push(entry); 
        closeModal('medModal'); 
        alert(`[${drugName} ${dose}mg] 복용 기록이 완료되었습니다.`);
        openModal('medChartModal'); 
        setTimeout(() => plotMedication(drug, dose, userProfile.weight), 200); 
        loadMotivationalStats();
    } catch (e) { 
        alert("저장 실패: " + e.message); 
    }
};

window.saveDate = async () => {
    if (!userId) return alert("로그인이 필요합니다.");
    const input = document.getElementById('dateTimeInput').value; 
    if (!input) return alert("일시를 선택해 주세요.");
    
    userQuitDate = input; 
    
    try {
        const docRef = await addDoc(collection(db, "users", userId, "challenges"), { 
            startDate: input, 
            endDate: null, 
            status: "active", 
            cravings: [], 
            startReason: document.getElementById('startReasonInput').value.trim(), 
            createdAt: new Date().getTime() 
        });
        currentChallengeId = docRef.id; 
        cravingData = []; 
        document.getElementById('cravingCount').innerText = 0; 
        document.getElementById('startReasonInput').value = ''; 
        startApp(input); 
        loadMotivationalStats();
    } catch (e) { 
        alert("연동 에러: " + e.message); 
    }
};

window.submitCraving = async () => {
    if (!userId || !currentChallengeId) return;
    const strength = document.getElementById('cravingRange').value;
    const reason = document.getElementById('cravingReason').value;
    
    const entry = { 
        date: new Date().toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'numeric', minute:'numeric'}), 
        strength: parseInt(strength), 
        reason: reason === '기타' ? document.getElementById('etcReason').value : reason, 
        timestamp: new Date().getTime() 
    };
    
    try {
        await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { cravings: arrayUnion(entry) });
        cravingData.push(entry); 
        document.getElementById('cravingCount').innerText = cravingData.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length;
        closeModal('cravingModal'); 
        alert("고비를 잘 넘기셨습니다!"); 
        loadMotivationalStats();
    } catch (e) { 
        alert("저장 실패: " + e.message); 
    }
};

window.submitAction = async (actionName, actionDesc) => {
    if (!userId || !currentChallengeId) return;
    const entry = { 
        type: 'action', 
        date: new Date().toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'numeric', minute:'numeric'}), 
        actionName, 
        actionDesc, 
        timestamp: new Date().getTime() 
    };
    
    try {
        await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { cravings: arrayUnion(entry) });
        cravingData.push(entry); 
        document.getElementById('cravingCount').innerText = cravingData.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length;
        closeModal('actionModal'); 
        alert(`훌륭합니다! [${actionName}] 행동을 기록했습니다.\n고비를 넘기는 힘이 점점 더 강해지고 있습니다.`); 
        loadMotivationalStats();
    } catch (e) { 
        alert("저장 실패: " + e.message); 
    }
};

window.submitState = async () => {
    if (!userId || !currentChallengeId) return;
    
    const getVal = (id) => { 
        const el = document.getElementById(id); 
        return (el && el.getAttribute('data-touched') === 'true') ? parseInt(el.value) : null; 
    };
    
    const withdrawal = getVal('withdrawalRange');
    const mood = getVal('moodRange');
    const thirst = getVal('thirstRange');
    const fatigue = getVal('fatigueRange');
    const stress = getVal('stressRange');
    const sleep = getVal('sleepRange');
    const hunger = getVal('hungerRange');
    
    if (withdrawal === null && mood === null && thirst === null && fatigue === null && stress === null && sleep === null && hunger === null) {
        return alert("기록할 몸상태의 슬라이드 바를 움직여 하나 이상 선택해 주세요.");
    }
    
    const entry = { 
        type: 'state', 
        date: new Date().toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'numeric', minute:'numeric'}), 
        timestamp: new Date().getTime() 
    };
    
    if (withdrawal !== null) entry.withdrawal = withdrawal; 
    if (mood !== null) entry.mood = mood; 
    if (thirst !== null) entry.thirst = thirst; 
    if (fatigue !== null) entry.fatigue = fatigue; 
    if (stress !== null) entry.stress = stress; 
    if (sleep !== null) entry.sleep = sleep; 
    if (hunger !== null) entry.hunger = hunger;
    
    try {
        await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { cravings: arrayUnion(entry) });
        cravingData.push(entry); 
        document.getElementById('cravingCount').innerText = cravingData.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length;
        closeModal('stateModal'); 
        alert("선택하신 현재 몸상태가 성공적으로 기록되었습니다."); 
        loadMotivationalStats();
    } catch (e) { 
        alert("저장 실패: " + e.message); 
    }
};

window.submitEval = async () => {
    if (!userId || !currentChallengeId) return;
    
    const entry = { 
        type: 'eval', 
        date: new Date().toLocaleString('ko-KR', {month:'short', day:'numeric', hour:'numeric', minute:'numeric'}), 
        effect: parseInt(document.getElementById('evalEffectRange').value), 
        strength: parseInt(document.getElementById('evalCravingRange').value), 
        timestamp: new Date().getTime() 
    };
    
    try {
        await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { cravings: arrayUnion(entry) });
        cravingData.push(entry); 
        document.getElementById('cravingCount').innerText = cravingData.filter(d => !['action', 'state', 'eval', 'medication'].includes(d.type)).length;
        closeModal('evalModal'); 
        alert("평가가 훌륭하게 기록되었습니다!"); 
        loadMotivationalStats();
    } catch (e) { 
        alert("저장 실패: " + e.message); 
    }
};

window.resetDate = async () => {
    if (confirm("금주 실패를 기록하고, 새롭게 단주에 도전하시겠습니까?\n(과거의 도전 기록은 모두 보존됩니다.)")) {
        const failReason = prompt("다음 도전을 위해 이번 단주 중단(실패) 사유를 기록해 주세요. (선택)") || "";
        try { 
            if (userId && currentChallengeId) {
                await updateDoc(doc(db, "users", userId, "challenges", currentChallengeId), { 
                    status: 'failed', 
                    endDate: new Date().toISOString(), 
                    failReason: failReason.trim() 
                });
            }
            localStorage.removeItem('quitDrinkingDateTime_server'); 
            currentChallengeId = null; 
            cravingData = []; 
            userQuitDate = null;
            document.getElementById('setupArea').style.display = 'flex'; 
            document.getElementById('displayArea').style.display = 'none';
            if (timerInterval) clearInterval(timerInterval); 
            loadMotivationalStats();
        } catch (e) { 
            alert("재설정 실패: " + e.message); 
        }
    }
};

window.openCalendarModal = (mode) => { 
    currentCalMode = mode; 
    currentCalDate = new Date(); 
    renderCalendar(currentCalDate.getFullYear(), currentCalDate.getMonth(), mode); 
    openModal('calendarModal'); 
};

window.changeCalMonth = (offset) => { 
    currentCalDate.setMonth(currentCalDate.getMonth() + offset); 
    renderCalendar(currentCalDate.getFullYear(), currentCalDate.getMonth(), currentCalMode); 
};

// UI 함수 매핑
window.openModal = openModal;
window.closeModal = closeModal;
window.toggleEtc = toggleEtc;
window.markTouched = markTouched;
window.updateRangeStyle = updateRangeStyle;
window.resetStateModal = resetStateModal;
