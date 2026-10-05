// Both disclosures keep existing modal handlers and restore focus before opening them.
const disclosures = [];
function installDisclosure(prefix, label, closeName) {
    const root = document.getElementById(`${prefix}Menu`);
    if (!root) return;
    const toggle = document.getElementById(`${prefix}Toggle`);
    const items = document.getElementById(`${prefix}Items`);
    const backdrop = document.getElementById(`${prefix}Backdrop`);
    const buttons = [...items.querySelectorAll('.floating-action-item')];
    function setOpen(open, restoreFocus = false) {
        if (restoreFocus && items.contains(document.activeElement)) toggle.focus({preventScroll:true});
        root.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', `${label} 메뉴 ${open ? '닫기' : '열기'}`);
        document.getElementById(`${prefix}Label`).textContent = open ? '닫기' : label === '빠른 기능' ? '메뉴' : label;
        items.inert = !open;
        items.setAttribute('aria-hidden', String(!open));
        backdrop.hidden = !open;
        if (open) {
            window.closeFloatingQuickNav?.();
            disclosures.forEach(other => { if (other.root !== root) other.close(); });
        }
    }
    disclosures.push({root, close:() => setOpen(false, true)});
    window[closeName] = () => setOpen(false, true);
    toggle.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
    backdrop.addEventListener('click', () => setOpen(false, true));
    items.addEventListener('click', event => {
        if (event.target.closest('.floating-action-item')) {
            toggle.focus({preventScroll:true}); setOpen(false);
        }
    }, true);
    root.addEventListener('keydown', event => {
        const index = buttons.indexOf(document.activeElement);
        let next;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else return;
        event.preventDefault(); setOpen(true); buttons[next].focus({preventScroll:true});
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && root.classList.contains('is-open')) { event.preventDefault(); setOpen(false, true); }
    });
    document.addEventListener('focusin', event => {
        if (root.classList.contains('is-open') && !root.contains(event.target)) setOpen(false);
    });
    document.addEventListener('app:tabchange', () => setOpen(false, true));
}
installDisclosure('floatingAction', '빠른 기능', 'closeFloatingActionMenu');
installDisclosure('floatingCraving', '갈망', 'closeFloatingCravingMenu');
