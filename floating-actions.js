// A disclosure of existing action buttons: their original handlers stay attached.
const root = document.getElementById('floatingActionMenu');
const toggle = document.getElementById('floatingActionToggle');
const items = document.getElementById('floatingActionItems');
const backdrop = document.getElementById('floatingActionBackdrop');
const buttons = [...items.querySelectorAll('.floating-action-item')];

function setOpen(open, restoreFocus = false) {
    if (restoreFocus && items.contains(document.activeElement)) toggle.focus({preventScroll: true});
    root.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `빠른 기능 메뉴 ${open ? '닫기' : '열기'}`);
    document.getElementById('floatingActionLabel').textContent = open ? '닫기' : '메뉴';
    items.inert = !open;
    items.setAttribute('aria-hidden', String(!open));
    backdrop.hidden = !open;
    if (open) window.closeFloatingQuickNav?.();
}
window.closeFloatingActionMenu = () => setOpen(false, true);
toggle.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
backdrop.addEventListener('click', () => setOpen(false, true));
// Collapse before each original handler runs, so dialogs restore focus to the
// visible menu toggle instead of a hidden action when they close.
items.addEventListener('click', event => {
    if (event.target.closest('.floating-action-item')) {
        toggle.focus({preventScroll: true});
        setOpen(false);
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
    event.preventDefault();
    setOpen(true);
    buttons[next].focus({preventScroll: true});
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root.classList.contains('is-open')) {
        event.preventDefault(); setOpen(false, true);
    }
});
document.addEventListener('focusin', event => {
    if (root.classList.contains('is-open') && !root.contains(event.target)) setOpen(false);
});
document.addEventListener('app:tabchange', () => setOpen(false, true));
