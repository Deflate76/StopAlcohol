// Let the browser paint the usable screen before optional network/CPU work.
export function afterPaint(win = globalThis) {
    return new Promise(resolve => {
        let first, second, done = false;
        const finish = () => {
            if (done) return;
            done = true; win.clearTimeout(timer);
            win.cancelAnimationFrame?.(first); win.cancelAnimationFrame?.(second); resolve();
        };
        const timer = win.setTimeout(finish, win.requestAnimationFrame ? 120 : 0); // Hidden tabs / non-visual environments.
        if (win.requestAnimationFrame) first = win.requestAnimationFrame(() => { second = win.requestAnimationFrame(finish); });
    });
}

export async function backgroundTask(task, {win = globalThis, valid = () => true} = {}) {
    await afterPaint(win);
    if (valid()) return task();
}

export async function loadHomeEssentials({profile, active, valid, render}) {
    // Neither call waits for the other; diary/history/AI/weather are not on this path.
    const [user, challenge] = await Promise.all([profile(), active()]);
    if (valid()) return render(user, challenge);
}
