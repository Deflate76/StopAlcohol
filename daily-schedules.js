// Shared schedule editor for the health diary and floating action button.
export function installDailySchedules({auth, functions, httpsCallable, onAuthStateChanged, getPushToken}) {
    const el = id => document.getElementById(id);
    const dialog = el('dailyScheduleModal'), form = el('dailyScheduleForm');
    const call = async data => (await httpsCallable(functions, 'dailyScheduleApi', {timeout: 60000})(data)).data;
    const pad = value => String(value).padStart(2, '0');
    const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const timeKey = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
    const uuid = () => crypto.randomUUID();
    const state = {uid: null, generation: 0, busy: false, id: null, revision: 0, original: null, request: null, pendingLink: null,
        returnFocus: null, lists: {dialog: {day: null, seq: 0, events: [], cursor: null}, health: {day: null, seq: 0, events: [], cursor: null}}};
    const current = (uid, generation) => !!uid && state.uid === uid && auth.currentUser?.uid === uid && state.generation === generation;
    const format = value => new Date(value).toLocaleString('ko-KR', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
    function status(id, message = '', error = false) { el(id).textContent = message; el(id).classList.toggle('is-error', error); }
    function errorText(error) {
        const code = String(error?.code || '');
        if (/aborted|invalid-argument|failed-precondition|not-found/.test(code)) return error.message;
        if (/unauthenticated|permission-denied/.test(code)) return '로그인 또는 앱 인증을 확인할 수 없습니다. 다시 로그인한 뒤 시도해 주세요.';
        if (/unavailable|deadline-exceeded|internal/.test(code)) return '일정 서버에 연결하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.';
        return error.message || '일정을 처리하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
    }
    function parseLocal(date, time) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
        const value = new Date(`${date}T${time}:00`);
        return dateKey(value) === date && timeKey(value) === time && value.getFullYear() >= 2000 && value.getFullYear() < 2100 ? value.getTime() : NaN;
    }
    function dayRange(day) {
        const from = parseLocal(day, '00:00');
        if (!Number.isFinite(from)) throw new Error('조회 날짜를 확인해 주세요.');
        const next = new Date(from); next.setDate(next.getDate() + 1);
        return {from, to: next.getTime()};
    }
    function setDateTime(prefix, value) {
        const date = new Date(value); el(`${prefix}Date`).value = dateKey(date); el(`${prefix}Time`).value = timeKey(date);
    }
    function readReminder(startAt) {
        const choice = el('dsReminder').value;
        if (choice === 'none') return null;
        return choice === 'custom' ? parseLocal(el('dsReminderDate').value, el('dsReminderTime').value) : startAt - Number(choice) * 60000;
    }
    function preview() {
        const custom = el('dsReminder').value === 'custom';
        el('dsCustomReminder').hidden = !custom;
        for (const id of ['dsReminderDate', 'dsReminderTime']) el(id).required = custom;
        const reminder = readReminder(parseLocal(el('dsStartDate').value, el('dsStartTime').value));
        el('dsReminderPreview').textContent = reminder === null ? '푸시 알림 없이 일정만 저장합니다.' : Number.isFinite(reminder) ? `알림 예정: ${format(reminder)}` : '알림 날짜와 시각을 입력해 주세요.';
        el('dsTimeZone').textContent = `날짜와 시각은 이 기기의 시간대(${timeZone()}) 기준입니다.`;
        el('dsNotificationHint').textContent = !('Notification' in window) ? '이 브라우저는 푸시를 지원하지 않습니다. 알림 없이 저장할 수 있습니다.' : Notification.permission === 'denied' ? '알림이 차단되어 있습니다. 브라우저 설정에서 허용하거나 ‘알림 없음’을 선택해 주세요.' : '알림에는 일정 제목과 시작 시각이 표시됩니다. 기기 설정에 따라 도착이 늦어질 수 있습니다.';
    }
    function setBusy(busy) {
        const finished = state.busy && !busy;
        state.busy = busy;
        el('dsFields').disabled = busy;
        for (const id of ['dsClose', 'dsNew', 'dsListDate', 'dsRefresh']) el(id).disabled = busy;
        dialog.setAttribute('aria-busy', String(busy));
        for (const scope of ['dialog', 'health']) {
            el(scope === 'dialog' ? 'dsList' : 'healthDaySchedules').querySelectorAll('button').forEach(button => { button.disabled = busy; });
        }
        if (finished && state.pendingLink && state.uid) {
            const linked = state.pendingLink, owner = state.uid, generation = state.generation;
            state.pendingLink = null;
            setTimeout(() => {
                if (!current(owner, generation) || state.busy) return;
                if (!dialog.open || confirm('알림의 일정을 열까요? 현재 입력 중인 내용은 저장되지 않습니다.')) openLinkedEvent(linked);
            }, 0);
        }
    }
    function resetForm(day = dateKey(new Date())) {
        form.reset();
        state.id = uuid(); state.revision = 0; state.original = null; state.request = null;
        const today = dateKey(new Date());
        const start = day === today ? new Date(Math.ceil((Date.now() + 3600000) / 900000) * 900000) : new Date(`${day}T09:00:00`);
        setDateTime('dsStart', start); setDateTime('dsEnd', start.getTime() + 3600000);
        setDateTime('dsReminder', start.getTime() - 600000);
        el('dsReminder').value = start > new Date() ? '10' : 'none';
        el('dsEditorTitle').textContent = '일정 등록'; el('dsSave').textContent = '일정 등록';
        preview();
    }
    function fillForm(event) {
        state.id = event.id; state.revision = event.revision; state.original = event; state.request = null;
        el('dsTitle').value = event.title; el('dsNote').value = event.note;
        setDateTime('dsStart', event.startAt); setDateTime('dsEnd', event.endAt);
        el('dsReminder').value = event.reminderChoice;
        setDateTime('dsReminder', event.reminderAt ?? event.startAt - 600000);
        el('dsEditorTitle').textContent = '일정 수정'; el('dsSave').textContent = '변경 저장';
        status('dsStatus', '일정을 수정하고 있습니다.'); preview();
        dialog.scrollTop = 0; el('dsTitle').focus({preventScroll: true});
    }
    const labels = {none: '알림 없음', pending: '알림 예약됨', sent: '알림 발송 완료', partial: '일부 기기에만 발송됨', failed: '알림 발송 실패 · 미래 시각으로 다시 설정해 주세요', missed: '알림 시각 경과 · 미발송'};
    function renderList(scope) {
        const list = state.lists[scope], container = el(scope === 'dialog' ? 'dsList' : 'healthDaySchedules');
        container.replaceChildren();
        if (!list.events.length) {
            const empty = document.createElement('p'); empty.className = 'health-muted';
            empty.textContent = list.cursor ? '현재 조회한 범위에 일정이 없습니다. 더 보기를 눌러 이전에 시작한 일정도 확인하세요.' : '이 날짜에 등록된 일정이 없습니다.';
            container.append(empty);
        }
        [...list.events].sort((a, b) => a.startAt - b.startAt).forEach(event => {
            const card = document.createElement('article'); card.className = 'ds-saved';
            const title = document.createElement('strong'); title.textContent = event.title;
            const range = document.createElement('p'); range.textContent = `${format(event.startAt)} ~ ${format(event.endAt)}`;
            const reminder = document.createElement('p'); reminder.className = 'health-muted';
            reminder.textContent = `${labels[event.reminderStatus] || '알림 상태 확인 중'}${event.reminderAt !== null ? ` · ${format(event.reminderAt)}` : ''}`;
            card.append(title, range, reminder);
            if (event.note) { const note = document.createElement('p'); note.className = 'ds-note'; note.textContent = event.note; card.append(note); }
            const actions = document.createElement('div'); actions.className = 'health-actions';
            const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'health-btn'; edit.textContent = '수정'; edit.disabled = state.busy;
            edit.addEventListener('click', () => { if (state.busy) return; if (!dialog.open) open(list.day); fillForm(event); });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'health-btn danger'; remove.textContent = '삭제'; remove.disabled = state.busy;
            remove.addEventListener('click', () => removeEvent(event));
            actions.append(edit, remove); card.append(actions); container.append(card);
        });
        if (list.cursor) {
            const more = document.createElement('button'); more.type = 'button'; more.className = 'health-btn'; more.textContent = '이전에 시작한 일정 더 보기'; more.disabled = state.busy;
            more.addEventListener('click', () => loadList(scope, true)); container.append(more);
        }
    }
    async function loadList(scope, more = false) {
        const list = state.lists[scope], day = list.day;
        if (!state.uid || !day) return;
        const owner = state.uid, generation = state.generation, seq = ++list.seq;
        const statusId = scope === 'dialog' ? 'dsListStatus' : 'healthScheduleStatus';
        const isCurrent = () => current(owner, generation) && list.seq === seq && list.day === day;
        if (!more) { list.events = []; list.cursor = null; el(scope === 'dialog' ? 'dsList' : 'healthDaySchedules').replaceChildren(); }
        status(statusId, '일정을 불러오고 있습니다…');
        try {
            const result = await call({action: 'list', ...dayRange(day), cursor: more ? list.cursor : null});
            if (!isCurrent()) return;
            list.events = [...new Map([...list.events, ...result.events].map(event => [event.id, event])).values()];
            list.cursor = result.nextCursor; renderList(scope); status(statusId);
        } catch (error) { if (isCurrent()) status(statusId, errorText(error), true); }
    }
    function refreshLists() {
        for (const scope of ['dialog', 'health']) if (state.lists[scope].day) loadList(scope);
    }
    function open(day = dateKey(new Date())) {
        if (!state.uid || auth.currentUser?.uid !== state.uid) { alert('로그인 후 일정을 등록해 주세요.'); return false; }
        if (state.busy) return false;
        try { dayRange(day); } catch { day = dateKey(new Date()); }
        state.returnFocus = document.activeElement;
        resetForm(day); status('dsStatus');
        state.lists.dialog.day = day; el('dsListDate').value = day;
        if (!dialog.open) dialog.showModal();
        el('dailyScheduleFloatingButton').setAttribute('aria-expanded', 'true');
        el('healthDayScheduleButton').setAttribute('aria-expanded', 'true');
        dialog.scrollTop = 0; el('dsTitle').focus({preventScroll: true}); loadList('dialog');
        return true;
    }
    window.openDailySchedule = open;
    el('dailyScheduleFloatingButton').addEventListener('click', () => open());
    el('dsClose').addEventListener('click', () => { if (!state.busy) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        el('dailyScheduleFloatingButton').setAttribute('aria-expanded', 'false');
        el('healthDayScheduleButton').setAttribute('aria-expanded', 'false');
        if (state.returnFocus?.isConnected) state.returnFocus.focus({preventScroll: true});
    });
    el('dsNew').addEventListener('click', () => { resetForm(state.lists.dialog.day); status('dsStatus'); el('dsTitle').focus(); });
    form.addEventListener('input', preview);
    form.addEventListener('change', preview);
    el('dsListDate').addEventListener('change', () => {
        try { dayRange(el('dsListDate').value); } catch { return; }
        state.lists.dialog.day = el('dsListDate').value; loadList('dialog');
    });
    el('dsRefresh').addEventListener('click', () => loadList('dialog'));
    el('healthScheduleRefresh').addEventListener('click', () => loadList('health'));
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (state.busy || !form.reportValidity()) return;
        const owner = state.uid, generation = state.generation;
        if (!current(owner, generation)) return;
        const startAt = parseLocal(el('dsStartDate').value, el('dsStartTime').value);
        const endAt = parseLocal(el('dsEndDate').value, el('dsEndTime').value);
        const reminderAt = readReminder(startAt);
        const title = el('dsTitle').value.trim();
        if (!title) return status('dsStatus', '일정 제목을 입력해 주세요.', true);
        if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return status('dsStatus', '종료 날짜와 시각은 시작보다 나중이어야 합니다.', true);
        const sameReminder = state.original?.reminderAt === reminderAt && state.original?.startAt === startAt;
        if (reminderAt !== null && (!Number.isFinite(reminderAt) || reminderAt > startAt || (!sameReminder && reminderAt <= Date.now()))) {
            return status('dsStatus', '알림은 현재보다 미래이면서 일정 시작 시각 또는 그 이전으로 선택해 주세요.', true);
        }
        const payload = {id: state.id, title, note: el('dsNote').value.trim(), startAt, endAt, timeZone: timeZone(), reminderChoice: el('dsReminder').value, reminderAt};
        const signature = JSON.stringify({payload, revision: state.revision});
        if (state.request?.signature !== signature) state.request = {signature, id: uuid()};
        const requestId = state.request.id, expectedRevision = state.revision;
        setBusy(true); status('dsStatus', '일정을 저장하고 있습니다…');
        try {
            let pushToken;
            if (reminderAt !== null && (!sameReminder || reminderAt > Date.now())) {
                if (!('Notification' in window)) throw new Error('이 브라우저는 푸시를 지원하지 않습니다. 알림 없음을 선택해 주세요.');
                // Request within the explicit save gesture (important on mobile browsers).
                const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
                if (!current(owner, generation)) return;
                if (permission !== 'granted') throw new Error('알림을 허용하거나 ‘알림 없음’을 선택한 뒤 다시 저장해 주세요.');
                pushToken = await getPushToken();
                if (!current(owner, generation)) return;
            }
            const result = await call({action: 'save', event: payload, expectedRevision, requestId, ...(pushToken ? {pushToken} : {})});
            if (!current(owner, generation)) return;
            const day = dateKey(new Date(result.event.startAt));
            state.lists.dialog.day = day; el('dsListDate').value = day;
            resetForm(day); status('dsStatus', result.event.reminderAt === null ? '일정을 저장했습니다.' : `일정과 알림 설정을 저장했습니다. ${format(result.event.reminderAt)}`);
            refreshLists();
        } catch (error) { if (current(owner, generation)) status('dsStatus', errorText(error), true); }
        finally { if (current(owner, generation)) { setBusy(false); preview(); } }
    });
    async function removeEvent(event) {
        if (state.busy || !confirm(`“${event.title}” 일정을 삭제할까요?\n예약된 알림도 취소됩니다.`)) return;
        const owner = state.uid, generation = state.generation;
        if (!current(owner, generation)) return;
        const statusId = dialog.open ? 'dsStatus' : 'healthScheduleStatus';
        setBusy(true); status(statusId, '일정을 삭제하고 있습니다…');
        try {
            await call({action: 'delete', id: event.id, expectedRevision: event.revision});
            if (!current(owner, generation)) return;
            if (state.id === event.id) resetForm(state.lists.dialog.day);
            refreshLists(); status(statusId, '일정과 예약된 알림을 삭제했습니다.');
        } catch (error) { if (current(owner, generation)) status(statusId, errorText(error), true); }
        finally { if (current(owner, generation)) setBusy(false); }
    }
    async function openLinkedEvent(id) {
        const owner = state.uid, generation = state.generation;
        if (!current(owner, generation) || state.busy || !/^[\w-]{16,80}$/.test(id)) return;
        if (!open()) return;
        setBusy(true); status('dsStatus', '알림의 일정을 불러오고 있습니다…');
        try {
            const result = await call({action: 'get', id});
            if (!current(owner, generation) || !dialog.open) return;
            fillForm(result.event);
            const day = dateKey(new Date(result.event.startAt));
            state.lists.dialog.day = day; el('dsListDate').value = day; loadList('dialog');
        } catch (error) { if (current(owner, generation)) status('dsStatus', errorText(error), true); }
        finally { if (current(owner, generation)) setBusy(false); }
    }
    onAuthStateChanged(auth, user => {
        if (state.uid === (user?.uid || null)) return;
        const pendingLink = state.pendingLink;
        state.pendingLink = null;
        state.uid = user?.uid || null; state.generation++;
        state.returnFocus = null;
        if (dialog.open) dialog.close();
        setBusy(false); resetForm(); status('dsStatus'); status('dsListStatus'); status('healthScheduleStatus');
        for (const scope of ['dialog', 'health']) { const list = state.lists[scope]; list.seq++; list.events = []; list.cursor = null; list.day = null; }
        el('dsList').replaceChildren(); el('healthDaySchedules').replaceChildren();
        if (!user) return;
        const owner = state.uid, generation = state.generation;
        if ('Notification' in window && Notification.permission === 'granted') {
            getPushToken().then(token => { if (current(owner, generation)) return call({action: 'registerDevice', pushToken: token}); }).catch(() => {});
        }
        const linked = pendingLink || new URLSearchParams(window.location.search).get('schedule');
        if (linked) openLinkedEvent(linked);
    });
    navigator.serviceWorker?.addEventListener('message', event => {
        if (event.data?.type !== 'daily-schedule-open' || !/^[\w-]{16,80}$/.test(event.data.id)) return;
        if (!state.uid || state.busy) { state.pendingLink = event.data.id; return; }
        if (dialog.open) {
            // A notification must not silently replace a form the user is editing.
            if (!confirm('알림의 일정을 열까요? 현재 입력 중인 내용은 저장되지 않습니다.')) return;
        }
        openLinkedEvent(event.data.id);
    });
    return {
        showDay(day) { state.lists.health.day = day; loadList('health'); },
        async showPush(payload) {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) await registration.showNotification(payload.data.title, {
                body: payload.data.body, icon: '/favicon.ico', tag: payload.data.tag, renotify: false,
                data: {url: payload.data.url}
            });
            refreshLists();
        }
    };
}
