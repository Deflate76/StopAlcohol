// Remember the heading where a tap started: live record/chart updates can move
// a different section under the pointer before the browser dispatches its click.
export function installSectionSelection({doc=document, onToggle=()=>{}, now=Date.now}={}) {
    const root=doc.getElementById('displayArea');
    const selector='details.main-section, .inline-collapsible-section';
    let selectedId='timerDisplaySection', press=null, pendingClick=null;
    function refresh() {
        root?.querySelectorAll(selector).forEach(section => {
            const selected=section.id===selectedId;
            section.classList.toggle('is-selected-section',selected);
            section.querySelector(':scope > summary, :scope > .inline-collapsible-summary')?.setAttribute('data-section-selected',String(selected));
        });
    }
    function select(target) {
        const section=typeof target==='string'?doc.getElementById(target):target;
        if(!section?.matches(selector) || !root?.contains(section))return;
        selectedId=section.id;refresh();
    }
    function headingAt(target) {
        const heading=target?.closest?.('summary, .inline-collapsible-summary');
        if(!heading || !heading.parentElement?.matches(selector) || !root?.contains(heading))return null;
        const control=target.closest?.('a, button, input, select, textarea, [contenteditable="true"], [role="button"]');
        return control && control!==heading ? null : heading;
    }
    function toggleHeading(heading) {
        const section=heading?.parentElement;
        if(!section?.isConnected || !root?.contains(section))return;
        const open=section.matches('details') ? !section.open : section.getAttribute('data-collapsed')==='true';
        if(section.matches('details'))section.open=open;
        else {
            section.setAttribute('data-collapsed',String(!open));
            heading.setAttribute('aria-expanded',String(open));
        }
        select(section);
        heading.focus({preventScroll:true});
        onToggle(section,open);
        doc.dispatchEvent(new doc.defaultView.CustomEvent('app:sectiontoggle',{detail:{id:section.id,open}}));
    }
    doc.addEventListener('pointerdown',event => {
        pendingClick=null;
        const heading=headingAt(event.target);
        press=heading && event.button===0 && event.isPrimary!==false
            ? {heading,id:heading.parentElement.id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,at:now(),moved:false}
            : null;
    },true);
    doc.addEventListener('pointermove',event => {
        if(press?.pointerId===event.pointerId && Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)press.moved=true;
    },{capture:true,passive:true});
    doc.addEventListener('pointercancel',() => {
        if(press)pendingClick={at:now()};
        press=null;
    },true);
    doc.addEventListener('contextmenu',() => {if(press)press.moved=true;},true);
    doc.addEventListener('pointerup',event => {
        if(!press || press.pointerId!==event.pointerId)return;
        const started=press;press=null;
        pendingClick={at:now()};
        if(started.moved || now()-started.at>700 || Math.hypot(event.clientX-started.x,event.clientY-started.y)>10)return;
        // A live summary may have been replaced while the finger was down.
        const heading=started.heading.isConnected ? started.heading
            : doc.getElementById(started.id)?.querySelector(':scope > summary, :scope > .inline-collapsible-summary');
        toggleHeading(heading);
    },true);
    doc.addEventListener('click',event => {
        const pending=pendingClick;pendingClick=null;
        if(pending && now()-pending.at<1000 && event.detail!==0) {
            // The same gesture has already been handled, even if layout shifts
            // made the compatibility click land on a different section/control.
            event.preventDefault();event.stopPropagation();return;
        }
        const heading=headingAt(event.target);
        if(heading) {
            // Keyboard/assistive activation and browsers without pointer events.
            event.preventDefault();event.stopPropagation();toggleHeading(heading);return;
        }
        if(root?.contains(event.target))select(event.target.closest?.(selector));
    },true);
    refresh();
    return {select,refresh};
}
