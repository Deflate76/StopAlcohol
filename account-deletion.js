export function clearAccountLocalData(uid, storage = localStorage, session = sessionStorage) {
    const exact = new Set([
        `alcoholaway:medication-reminders:v1:${uid}`, `alcoholaway.otc.scan-history.v1.${uid}`,
        `calMedicationNonMedStartDate_${uid}`, `alcoholaway_control_drinking_goal_${uid}`,
        `alcoholaway-community-read:${uid}`, 'quitDrinkingDateTime_server'
    ]);
    try {
        for (let i = storage.length-1; i >= 0; i--) {
            const key = storage.key(i);
            if (exact.has(key) || key?.startsWith(`ackedAlerts_${uid}_`)) storage.removeItem(key);
        }
        session.removeItem('session_visited');
    } catch { /* Storage may be unavailable in private browsing. */ }
}

export function installAccountDeletion({auth, functions, httpsCallable, reauthenticateWithPopup,
    googleProvider, signOut, clearPushToken, quiesce, dom = document, win = window}) {
    const button = dom.getElementById('deleteAccountBtn');
    const dialog = dom.getElementById('deleteAccountDialog');
    const confirm = dom.getElementById('confirmDeleteAccountBtn');
    const cancel = dom.getElementById('cancelDeleteAccountBtn');
    const status = dom.getElementById('deleteAccountStatus');
    const call = httpsCallable(functions, 'deleteMyAccount', {timeout:540000});
    let busy = false, deleting = false, owner = null;
    const update = message => { status.textContent = message; };
    button.addEventListener('click', () => {
        if (!auth.currentUser) return win.alert('로그인 후 이용해 주세요.');
        owner = auth.currentUser.uid;
        update(''); dialog.showModal(); cancel.focus();
    });
    cancel.addEventListener('click', () => { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    confirm.addEventListener('click', async () => {
        if (busy) return;
        const user = auth.currentUser;
        if (!user || user.uid !== owner) { update('로그인 계정이 바뀌었습니다. 창을 닫고 다시 시도해 주세요.'); return; }
        busy = true; confirm.disabled = cancel.disabled = true;
        try {
            update('본인 확인을 진행합니다…');
            // Open the popup within the button gesture so mobile browsers allow it.
            await reauthenticateWithPopup(user, googleProvider);
            if (auth.currentUser?.uid !== owner) throw {code:'account-changed'};
            await user.getIdToken(true);
            update('회원탈퇴를 준비하고 있습니다…');
            await call({action:'status'}); // No data is changed if server permissions are missing.
            deleting = true;
            quiesce();
            update('계정과 회원 정보를 삭제하고 있습니다. 잠시 기다려 주세요…');
            const {data} = await call({confirm:true});
            if (!data?.accepted) throw {code:'unconfirmed'};
            if (auth.currentUser?.uid === owner) {
                try { await clearPushToken(); } catch { /* Server also removes all registrations. */ }
                clearAccountLocalData(owner, win.localStorage, win.sessionStorage);
                await signOut(auth);
            }
            update(data.deleted ? '회원탈퇴가 완료되었습니다.' : '탈퇴 요청이 접수되었습니다. 로그아웃 후에도 서버에서 남은 정보를 삭제합니다.');
            win.alert(status.textContent);
            win.location.replace(win.location.pathname);
        } catch (error) {
            const code = String(error?.code || '');
            if (code === 'functions/failed-precondition') update(error.message);
            else if (/popup-closed|cancelled-popup|user-cancelled/.test(code)) update('본인 확인을 취소했습니다. 탈퇴하지 않았습니다.');
            else if (/popup-blocked/.test(code)) update('본인 확인 창이 차단되었습니다. 팝업을 허용한 후 다시 시도해 주세요.');
            else if (/user-mismatch|account-changed/.test(code)) update('현재 로그인한 Google 계정으로 본인 확인해 주세요.');
            else if (deleting) update('탈퇴 결과를 확인하지 못했습니다. 이미 접수된 삭제는 서버에서 계속됩니다. 새로고침 후 로그인 상태를 확인해 주세요.');
            else update('회원탈퇴를 시작하지 못했습니다. 연결과 로그인 상태를 확인한 후 다시 시도해 주세요.');
            if (deleting) {
                confirm.hidden = true;
                cancel.textContent = '새로고침';
                cancel.addEventListener('click', () => win.location.reload(), {once:true});
            }
        } finally { busy = false; confirm.disabled = cancel.disabled = false; }
    });
    return {isDeleting:() => deleting};
}
