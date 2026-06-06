/**
 * 모달 관리 함수들
 */

export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
    }
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// 모든 모달에 대한 클릭 외부 닫기
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});

export function toggleEtc(value) {
    const etcReason = document.getElementById('etcReason');
    if (value === '기타') {
        etcReason.style.display = 'block';
    } else {
        etcReason.style.display = 'none';
    }
}
