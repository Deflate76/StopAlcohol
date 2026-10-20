// Selection changes only the visual emphasis; existing collapse/expand controls keep ownership.
export function installSectionSelection({doc=document}={}) {
    const root=doc.getElementById('displayArea');
    const selector='details.main-section, .inline-collapsible-section';
    let selectedId='timerDisplaySection';
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
    root?.addEventListener('click',event => select(event.target.closest?.(selector)),true);
    refresh();
    return {select,refresh};
}
