// Uses the existing private photo metadata contract and health_records/{uid}/{id}.jpg.
// Album membership lives in an opaque document ID, so no permission/schema migration
// or public download token is needed. Existing consent withdrawal/account deletion
// covers these objects too. A separate document per photo avoids growing one document.
export const isDiagnosisPhoto = id => String(id).startsWith('diagnosis_');
export function diagnosisPhotoPrefix(id) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id || '')) throw new Error('질환 식별자를 확인해 주세요.');
    return `diagnosis_${id.length}_${id}_`;
}
export function diagnosisPhotoRows(rows, id, oldest = false) {
    const prefix = diagnosisPhotoPrefix(id);
    return rows.filter(row => row.id.startsWith(prefix)).sort((a, b) => {
        const order = String(a.date).localeCompare(String(b.date))
            || String(a.createdAtClient).localeCompare(String(b.createdAtClient)) || a.id.localeCompare(b.id);
        return oldest ? order : -order;
    });
}

// Strip EXIF/GPS and encode a bounded JPEG; never send originals to AI services.
export async function prepareDiagnosisPhoto(file, document = globalThis.document) {
    if (!file?.type?.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('JPEG, PNG 등 사진 파일을 선택해 주세요.');
    if (!file.size || file.size > 40 * 1024 * 1024) throw new Error('사진 한 장의 원본 크기는 40MB 이하로 선택해 주세요.');
    const win = document.defaultView, url = win.URL.createObjectURL(file), img = new win.Image();
    try {
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('이 사진을 읽을 수 없습니다. JPEG 또는 PNG로 변환해 주세요.')); img.src = url; });
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h || w * h > 100000000) throw new Error('사진 해상도가 너무 크거나 올바르지 않습니다.');
        const scale = Math.min(1, 1920 / Math.max(w, h)), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const quality of [.88, .76, .62]) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
            if (blob?.size && blob.size <= 4 * 1024 * 1024) { canvas.width = canvas.height = 0; return blob; }
        }
        throw new Error('사진 크기를 줄이지 못했습니다. 더 작은 사진을 선택해 주세요.');
    } finally { win.URL.revokeObjectURL(url); img.src = ''; }
}

export function installDiagnosisPhotos({document = globalThis.document, context, rows, loaded, error, ensureTarget, consent,
    newId, upload, read, rename, remove, setBusy, prepare = prepareDiagnosisPhoto}) {
    const win = document.defaultView, el = id => document.getElementById(id);
    let epoch = 0, renderEpoch = 0, cameraEpoch = 0, queue = [], urls = new Map(), stream = null, busy = false, adding = false, visible = 12, key = '', returnFocus;
    const state = () => context();
    const valid = (ctx, seq) => seq === epoch && ctx && state()?.uid === ctx.uid && state()?.target === ctx.target;
    const status = (text = '', failed = false) => { el('diagnosisPhotoStatus').textContent = text; el('diagnosisPhotoStatus').classList.toggle('is-error', failed); };
    const button = (text, fn) => { const node = document.createElement('button'); node.type = 'button'; node.className = 'health-btn'; node.textContent = text; node.addEventListener('click', fn); return node; };
    const stopCamera = () => { cameraEpoch++; stream?.getTracks().forEach(track => track.stop()); stream = null; el('diagnosisCameraVideo').srcObject = null; el('diagnosisCamera').hidden = true; };
    const release = () => { for (const url of urls.values()) win.URL.revokeObjectURL(url); urls.clear(); };
    function lock(value) { busy = value; setBusy(value); el('diagnosisPhotoActions').disabled = value; el('diagnosisPhotoSave').disabled = value || !queue.length; el('diagnosisPhotoOrder').disabled = value; }
    function reset() {
        epoch++; renderEpoch++; stopCamera(); release();
        queue.forEach(item => win.URL.revokeObjectURL(item.url)); queue = []; key = ''; visible = 12; adding = false; busy = false;
        el('diagnosisPhotoQueue').replaceChildren(); el('diagnosisPhotoList').replaceChildren(); el('diagnosisPhotoCount').textContent = '';
        el('diagnosisPhotoViewer').hidden = true; el('diagnosisPhotoFull').removeAttribute('src');
        el('diagnosisPhotoFiles').value = ''; el('diagnosisPhotoCapture').value = ''; el('diagnosisPhotoSave').hidden = true;
        el('diagnosisPhotoConfirmed').checked = false; el('diagnosisPhotoConfirmation').hidden = true;
        el('diagnosisPhotoActions').disabled = false; el('diagnosisPhotoOrder').disabled = false; status();
    }
    function canClose(force = false) {
        if (!force && (busy || adding)) { status('사진 처리가 끝난 뒤 닫아 주세요.'); return false; }
        if (!force && queue.length && !win.confirm('아직 저장하지 않은 사진과 설명을 버리고 닫을까요?')) return false;
        reset(); return true;
    }
    function renderQueue() {
        const list = el('diagnosisPhotoQueue'); list.replaceChildren();
        for (const item of queue) {
            const card = document.createElement('article'); card.className = 'diagnosis-photo-draft';
            const img = document.createElement('img'); img.src = item.url; img.alt = '저장 전 사진';
            const label = document.createElement('label'); label.textContent = `${item.date} · 사진 설명 (100자)`;
            const input = document.createElement('textarea'); input.maxLength = 100; input.rows = 2; input.placeholder = '증상이나 변화를 적어주세요'; input.value = item.label; input.disabled = busy;
            input.addEventListener('input', () => { item.label = input.value; }); label.append(input);
            const discard = button('선택 취소', () => { if (busy) return; queue = queue.filter(row => row !== item); win.URL.revokeObjectURL(item.url); renderQueue(); }); discard.disabled = busy;
            card.append(img, label, discard); list.append(card);
        }
        el('diagnosisPhotoSave').hidden = !queue.length; el('diagnosisPhotoSave').disabled = busy || adding || !el('diagnosisPhotoConfirmed').checked;
        el('diagnosisPhotoConfirmation').hidden = !queue.length; el('diagnosisPhotoConfirmed').disabled = busy || adding;
        el('diagnosisPhotoSave').textContent = `사진 ${queue.length}장 저장`;
    }
    async function add(files) {
        const ctx = state(), seq = epoch;
        if (!ctx || busy || adding || ctx.blocked) return;
        if (!ctx.validDate) return status('오늘 또는 지난 기록 날짜를 선택해 주세요.', true);
        adding = true; el('diagnosisPhotoActions').disabled = true; setBusy(true);
        el('diagnosisPhotoConfirmed').checked = false;
        let failed = 0;
        try {
            // No count cap: decode one at a time to bound peak memory usage.
            for (const file of files) {
                if (!valid(ctx, seq)) return;
                try {
                    const blob = await prepare(file, document); if (!valid(ctx, seq)) return;
                    queue.push({blob, date:ctx.date, label:'', suffix:newId(), url:win.URL.createObjectURL(blob)});
                } catch (err) { failed++; if (valid(ctx, seq)) status(err.message, true); }
            }
        } finally {
            if (valid(ctx, seq)) { adding = false; setBusy(false); el('diagnosisPhotoActions').disabled = false; renderQueue();
                if (!failed) status('사진별 설명을 적고 저장해 주세요. 사진 수에는 제한이 없습니다.');
                el('diagnosisPhotoQueue').firstElementChild?.scrollIntoView?.({block:'nearest',behavior:'smooth'}); }
        }
    }
    async function camera() {
        const ctx = state(), seq = epoch; if (!ctx || busy || adding || ctx.blocked) return;
        stopCamera(); const cameraRequest = cameraEpoch;
        if (!win.navigator.mediaDevices?.getUserMedia || win.matchMedia?.('(pointer:coarse)').matches) { el('diagnosisPhotoCapture').click(); return; }
        try {
            const next = await win.navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
            if (!valid(ctx, seq) || cameraRequest !== cameraEpoch) { next.getTracks().forEach(track => track.stop()); return; }
            stream = next; el('diagnosisCamera').hidden = false; el('diagnosisCameraVideo').srcObject = stream; await el('diagnosisCameraVideo').play();
            if (valid(ctx,seq)) el('diagnosisCamera').scrollIntoView?.({block:'nearest',behavior:'smooth'});
        } catch { if (valid(ctx, seq) && cameraRequest === cameraEpoch) { stopCamera(); status('카메라를 열 수 없습니다. 브라우저 카메라 권한을 확인하거나 사진 추가를 이용해 주세요.', true); } }
    }
    async function save() {
        const ctx = state(), seq = epoch; if (!ctx || busy || adding || ctx.blocked || !queue.length) return;
        if (!el('diagnosisPhotoConfirmed').checked) return status('사진에 불필요한 개인정보가 없는지 확인해 주세요.', true);
        lock(true); stopCamera(); renderQueue();
        try {
            if (!await consent() || !valid(ctx, seq)) return;
            await ensureTarget(ctx); if (!valid(ctx, seq)) return;
            while (queue.length && valid(ctx, seq)) {
                const item = queue[0]; item.id ||= diagnosisPhotoPrefix(ctx.target.id) + item.suffix;
                const id = item.id;
                status(`사진 저장 중 · ${queue.length}장 남음`);
                await upload(ctx, id, item, percent => { if (valid(ctx, seq)) status(`사진 저장 ${percent}% · ${queue.length}장 남음`); });
                if (!valid(ctx, seq)) return;
                queue.shift(); win.URL.revokeObjectURL(item.url); renderQueue();
            }
            if (valid(ctx, seq)) { status('사진과 설명을 저장했습니다.'); refresh(true); }
        } catch (err) { if (valid(ctx, seq)) status(`저장하지 못한 사진은 그대로 남아 있습니다. ${err.message || '연결을 확인하고 다시 저장해 주세요.'}`, true); }
        finally { if (valid(ctx, seq)) { lock(false); renderQueue(); } }
    }
    async function mutate(fn) {
        const ctx = state(), seq = epoch; if (!ctx || busy || adding || ctx.blocked) return;
        lock(true);
        try { await fn(ctx); if (valid(ctx, seq)) { status('반영했습니다.'); refresh(true); } }
        catch (err) { if (valid(ctx, seq)) status(err.message || '반영하지 못했습니다. 다시 시도해 주세요.', true); }
        finally { if (valid(ctx, seq)) lock(false); }
    }
    function showFull(url, caption, origin) {
        returnFocus = origin; el('diagnosisPhotoFull').src = url; el('diagnosisPhotoFull').alt = caption;
        el('diagnosisPhotoFullCaption').textContent = caption; el('diagnosisPhotoViewer').hidden = false; el('diagnosisPhotoViewerClose').focus();
    }
    function closeFull() { el('diagnosisPhotoViewer').hidden = true; el('diagnosisPhotoFull').removeAttribute('src'); returnFocus?.focus(); }
    async function refresh(force = false) {
        const ctx = state(); if (!ctx) return;
        const records = diagnosisPhotoRows(rows(), ctx.target.id, el('diagnosisPhotoOrder').value === 'oldest');
        const nextKey = JSON.stringify([ctx.uid, ctx.target.id, visible, loaded(), error(), el('diagnosisPhotoOrder').value, records.map(r => [r.id,r.status,r.label,r.date,r.createdAtClient])]);
        if (!force && key === nextKey) return; key = nextKey;
        const seq = epoch, render = ++renderEpoch, list = el('diagnosisPhotoList'); list.replaceChildren();
        const shown = records.slice(0, visible), keep = new Set(shown.map(row => row.id));
        for (const [id, url] of urls) if (!keep.has(id)) { win.URL.revokeObjectURL(url); urls.delete(id); }
        el('diagnosisPhotoCount').textContent = `${records.length}장`;
        if (error()) { list.textContent = error(); return; }
        if (!loaded()) { list.textContent = '사진 기록을 불러오는 중입니다…'; return; }
        if (!records.length) { list.textContent = '사진으로 회복 과정을 남겨보세요.'; return; }
        const tasks = [];
        for (const row of shown) {
            const card = document.createElement('article'); card.className = 'diagnosis-photo-card';
            const time = document.createElement('time'); time.textContent = row.date; time.dateTime = row.date;
            const registered = new Date(row.createdAtClient || '');
            if (Number.isFinite(registered.getTime())) time.textContent += ` · 등록 ${registered.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}`;
            const caption = document.createElement('p'); caption.textContent = row.label || '설명 없음';
            const preview = button('사진 불러오는 중…', () => { if (urls.has(row.id)) showFull(urls.get(row.id), `${row.date} · ${row.label || '질환 사진'}`, preview); }); preview.classList.add('diagnosis-photo-preview');
            const actions = document.createElement('div'); actions.className = 'health-actions';
            const edit = button('설명 수정', () => {
                if (busy) return; const label = win.prompt('사진 설명 (최대 100자)', row.label || ''); if (label === null) return;
                if (label.length > 100) return status('사진 설명은 100자 이내로 입력해 주세요.', true);
                mutate(c => rename(c, row, label.trim()));
            });
            const del = button('사진 삭제', () => { if (!busy && win.confirm('이 사진과 설명을 삭제할까요?')) mutate(c => remove(c, row)); });
            actions.append(edit, del); card.append(time, preview, caption, actions); list.append(card);
            if (row.status !== 'ready') { preview.textContent = '업로드 미완료 · 작성 중인 사진을 다시 저장하거나 삭제해 주세요.'; preview.disabled = true; edit.disabled = true; continue; }
            const paint = () => { const img = document.createElement('img'); img.src = urls.get(row.id); img.alt = row.label || '질환 경과 사진'; img.loading = 'lazy'; preview.replaceChildren(img); preview.setAttribute('aria-label', `${row.date} 사진 크게 보기`); };
            if (urls.has(row.id)) paint();
            else tasks.push(async () => {
                if (!valid(ctx, seq) || render !== renderEpoch) return;
                try {
                    const blob = await read(ctx, row.id); if (!valid(ctx, seq) || render !== renderEpoch) return;
                    urls.set(row.id, win.URL.createObjectURL(blob)); paint();
                } catch { if (valid(ctx, seq) && render === renderEpoch) { preview.textContent = '사진을 불러오지 못했습니다 · 다시 불러오기'; preview.onclick = () => refresh(true); } }
            });
        }
        if (shown.length < records.length) list.append(button(`사진 더 보기 (${records.length - shown.length}장)`, () => { visible += 12; refresh(); }));
        const worker = async () => { while (tasks.length && valid(ctx, seq) && render === renderEpoch) await tasks.shift()(); };
        await Promise.all([worker(), worker(), worker()]);
    }
    el('diagnosisPhotoCamera').addEventListener('click', camera);
    el('diagnosisPhotoAdd').addEventListener('click', () => el('diagnosisPhotoFiles').click());
    for (const id of ['diagnosisPhotoFiles','diagnosisPhotoCapture']) el(id).addEventListener('change', event => { const files = [...event.target.files]; event.target.value = ''; add(files); });
    el('diagnosisCameraClose').addEventListener('click', stopCamera);
    el('diagnosisCameraShutter').addEventListener('click', async () => {
        const ctx = state(), seq = epoch, video = el('diagnosisCameraVideo'); if (!video.videoWidth || busy || adding) return;
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9)); stopCamera();
        if (blob && valid(ctx, seq)) add([blob]);
    });
    el('diagnosisPhotoSave').addEventListener('click', save);
    el('diagnosisPhotoConfirmed').addEventListener('change', renderQueue);
    el('diagnosisPhotoOrder').addEventListener('change', () => { visible = 12; refresh(); });
    el('diagnosisPhotoReload').addEventListener('click', () => refresh(true));
    el('diagnosisPhotoViewerClose').addEventListener('click', closeFull);
    el('diagnosisPhotoViewer').addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeFull(); } });
    win.addEventListener('pagehide', reset);
    return {refresh, reset, canClose, add, save};
}
