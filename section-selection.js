// Remember the heading where a tap started: live record/chart updates can move
// a different section under the pointer before the browser dispatches its click.
export function installSectionSelection({doc=document, onToggle=()=>{}, now=Date.now}={}) {
    const root=doc.getElementById('displayArea');
    const selector='details.main-section, .inline-collapsible-section';
    let selectedId='timerDisplaySection', press=null, pendingClick=null;
    const sectionHeading=section => section?.querySelector(':scope > summary, :scope > .inline-collapsible-summary');
    const isOpen=section => section.matches('details') ? section.open : section.getAttribute('data-collapsed')!=='true';
    function addCloseButton(section, heading) {
        if(!section.id || !heading)return;
        let footer=section.querySelector(':scope > .section-close-footer');
        if(!footer) {
            footer=doc.createElement('div');footer.className='section-close-footer';
            const button=doc.createElement('button');button.type='button';button.className='section-close-button';
            button.dataset.closeSection=section.id;button.setAttribute('aria-controls',section.id);
            const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');
            icon.setAttribute('viewBox','0 0 16 16');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
            const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m4 10 4-4 4 4');
            icon.append(path);button.append(icon,doc.createTextNode('접기'));footer.append(button);section.append(footer);
        }
        const title=(heading.querySelector('.diagnosis-summary-title, .timer-summary-label > span')?.textContent || heading.textContent).replace(/\s+/g,' ').trim();
        footer.querySelector('button').setAttribute('aria-label',`${title} 접기`);
    }
    function refresh() {
        root?.querySelectorAll(selector).forEach(section => {
            const selected=section.id===selectedId;
            section.classList.toggle('is-selected-section',selected);
            const heading=sectionHeading(section);
            heading?.setAttribute('data-section-selected',String(selected));
            addCloseButton(section,heading);
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
    function controlAt(target) {
        const button=target?.closest?.('button[data-close-section]');
        const section=button?.parentElement?.parentElement;
        if(button && section?.matches(selector) && root?.contains(section)
            && button.parentElement.classList.contains('section-close-footer') && button.dataset.closeSection===section.id) {
            return {heading:sectionHeading(section),close:true};
        }
        const heading=headingAt(target);
        return heading ? {heading,close:false} : null;
    }
    function revealClosedSection(id) {
        const section=doc.getElementById(id), heading=sectionHeading(section);
        if(!section || !root.contains(section) || isOpen(section) || !heading)return;
        heading.focus({preventScroll:true});
        heading.scrollIntoView?.({behavior:'instant',block:'start'});
    }
    function toggleHeading(heading, close=false) {
        const section=heading?.parentElement;
        if(!section?.isConnected || !root?.contains(section))return;
        if(close && !isOpen(section))return;
        const open=close ? false : !isOpen(section);
        if(section.matches('details'))section.open=open;
        else {
            section.setAttribute('data-collapsed',String(!open));
            heading.setAttribute('aria-expanded',String(open));
        }
        select(section);
        heading.focus({preventScroll:true});
        onToggle(section,open);
        doc.dispatchEvent(new doc.defaultView.CustomEvent('app:sectiontoggle',{detail:{id:section.id,open}}));
        if(close) {
            // Return focus after the touch compatibility click and layout update.
            const reveal=() => revealClosedSection(section.id);
            if(doc.defaultView.requestAnimationFrame)doc.defaultView.requestAnimationFrame(reveal);
            else reveal();
        }
    }
    doc.addEventListener('pointerdown',event => {
        pendingClick=null;
        const control=controlAt(event.target), heading=control?.heading;
        press=heading && event.button===0 && event.isPrimary!==false
            ? {heading,close:control.close,id:heading.parentElement.id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,at:now(),moved:false}
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
        if(started.close)pendingClick.closedId=started.id;
        // A live summary may have been replaced while the finger was down.
        const heading=started.heading.isConnected ? started.heading
            : doc.getElementById(started.id)?.querySelector(':scope > summary, :scope > .inline-collapsible-summary');
        toggleHeading(heading,started.close);
    },true);
    doc.addEventListener('mousedown',event => {
        // A synthetic mouse press after a touch must not focus the content
        // that replaced the footer at the same screen coordinates.
        if(pendingClick?.closedId && now()-pendingClick.at<1000)event.preventDefault();
    },true);
    doc.addEventListener('click',event => {
        const pending=pendingClick;pendingClick=null;
        if(pending && now()-pending.at<1000 && event.detail!==0) {
            // The same gesture has already been handled, even if layout shifts
            // made the compatibility click land on a different section/control.
            event.preventDefault();event.stopPropagation();
            if(pending.closedId)revealClosedSection(pending.closedId);
            return;
        }
        const control=controlAt(event.target);
        if(control?.heading) {
            // Keyboard/assistive activation and browsers without pointer events.
            event.preventDefault();event.stopPropagation();toggleHeading(control.heading,control.close);return;
        }
        if(root?.contains(event.target))select(event.target.closest?.(selector));
    },true);
    refresh();
    return {select,refresh};
}
