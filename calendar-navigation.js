// Calendar-only gestures leave vertical scrolling, taps and long presses available.
const VIEW_KEY = 'alcoholaway-calendar-view';
export function installCalendarNavigation({document:doc=globalThis.document, window:win=globalThis.window,
    navigate, cancelPress=()=>{}, now=()=>win.performance.now()}={}) {
    const modal=doc.getElementById('calendarModal'), grid=doc.getElementById('calendarDaysGrid');
    if (!modal || !grid) return;
    const compactButton=doc.getElementById('calCompactView'), detailButton=doc.getElementById('calDetailView');
    const viewStatus=doc.getElementById('calViewStatus');
    const viewOptions=modal.querySelector('.cal-view-options');
    const swipeHint=doc.getElementById('calSwipeHint'), swipeText=doc.getElementById('calSwipeText');
    const idleHint=swipeText?.innerHTML;
    let gesture=null, suppressClick=false, pendingTouchMonth=null;

    const swipeThreshold=()=>Math.min(72,Math.max(40,grid.clientWidth*.16));
    function resetHint() {
        swipeHint?.classList.remove('is-swiping');
        if (swipeText) swipeText.innerHTML=idleHint;
    }

    function setView(value, persist=true) {
        const compact=value==='compact';
        modal.classList.toggle('cal-compact',compact);
        if(viewOptions)viewOptions.dataset.view=compact?'compact':'detail';
        compactButton.setAttribute('aria-pressed',String(compact));
        detailButton.setAttribute('aria-pressed',String(!compact));
        viewStatus.textContent=compact?'축소 달력 보기':'상세 달력 보기';
        if (persist) { try { win.localStorage.setItem(VIEW_KEY,compact?'compact':'detail'); } catch {} }
    }
    let saved='detail';
    try { saved=win.localStorage.getItem(VIEW_KEY)||saved; } catch {}
    setView(saved,false);
    compactButton.addEventListener('click',()=>setView('compact'));
    detailButton.addEventListener('click',()=>setView('detail'));

    function cancel() {
        if (gesture) { suppressClick=true; cancelPress(); }
        gesture=null;pendingTouchMonth=null;
        resetHint();
    }
    grid.addEventListener('pointerdown',event=>{
        if (event.isPrimary===false || gesture && gesture.id!==event.pointerId) { cancel(); return; }
        if (event.button!==undefined && event.button!==0) return;
        if (event.target.closest('button,a,input,select,textarea')) return;
        suppressClick=false;
        resetHint();
        gesture={id:event.pointerId,x:event.clientX,y:event.clientY,start:now(),direction:null};
    },true);
    // A second finger anywhere cancels navigation, including a pinch starting outside the grid.
    win.addEventListener('pointerdown',event=>{
        if (gesture && gesture.id!==event.pointerId) cancel();
    },true);
    win.addEventListener('pointermove',event=>{
        if (!gesture || event.pointerId!==gesture.id) return;
        const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
        if (Math.hypot(dx,dy)<=10) return;
        suppressClick=true; cancelPress();
        if (!gesture.direction) {
            // A stationary 600 ms press belongs to the date's existing long-press action.
            if (now()-gesture.start>=600) { gesture=null; return; }
            if (Math.abs(dy)>=Math.abs(dx)) gesture.direction='vertical';
            else if (Math.abs(dx)>Math.abs(dy)*1.4) gesture.direction='horizontal';
        }
        if (gesture.direction==='horizontal' && swipeText) {
            swipeHint?.classList.add('is-swiping');
            const direction=dx<0?'다음 달':'이전 달';
            swipeText.textContent=Math.abs(dx)>=swipeThreshold()?`놓으면 ${direction}`:`${dx<0?'왼쪽':'오른쪽'}으로 더 밀어 ${direction} 보기`;
        }
    },{capture:true,passive:true});
    grid.addEventListener('touchmove',event=>{
        if (gesture?.direction==='horizontal' && event.touches.length===1 && event.cancelable) event.preventDefault();
    },{passive:false});
    win.addEventListener('pointerup',event=>{
        if (!gesture || event.pointerId!==gesture.id) return;
        const current=gesture;gesture=null;
        resetHint();
        const dx=event.clientX-current.x,dy=event.clientY-current.y;
        const threshold=swipeThreshold();
        if (current.direction!=='horizontal' || Math.abs(dx)<threshold || Math.abs(dx)<Math.abs(dy)*1.4 || now()-current.start>1500) return;
        suppressClick=true;cancelPress();
        const offset=dx<0?1:-1;
        // Touchend follows pointerup. Keep its target alive until the touch sequence finishes.
        if (event.pointerType==='touch') pendingTouchMonth=offset;
        else win.setTimeout(()=>navigate(offset),0);
    },true);
    win.addEventListener('touchend',()=>{
        if (pendingTouchMonth===null) return;
        const offset=pendingTouchMonth;pendingTouchMonth=null;
        win.setTimeout(()=>navigate(offset),0);
    },{capture:true,passive:true});
    win.addEventListener('pointercancel',cancel,true);
    win.addEventListener('blur',cancel);
    doc.addEventListener('visibilitychange',()=>{if(doc.hidden)cancel();});
    // Suppress the synthetic date click after a swipe; a new pointerdown allows the next tap.
    grid.addEventListener('click',event=>{
        if (suppressClick && event.detail!==0) { event.preventDefault();event.stopImmediatePropagation(); }
    },true);
    return {setView,isCompact:()=>modal.classList.contains('cal-compact')};
}
