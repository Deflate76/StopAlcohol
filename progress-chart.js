// Draw-only effects: never change scales, padding, canvas size, or layout boxes.
export function createProgressChartPlugin(Chart, win = window, dom = document) {
    const states = new WeakMap();
    const position = chart => {
        const annotations = chart.options.plugins.annotation.annotations;
        const id = chart.canvas.id === 'survivalChart' ? 'line1' : 'myPosition';
        const annotation = annotations[id];
        return {id, annotation, x: chart.scales.x?.getPixelForValue(Number(annotation?.xMin))};
    };
    function animate(chart, state) {
        if (state.frame || state.motion.matches || dom.hidden || !state.visible || state.destroyed) return;
        state.frame = win.requestAnimationFrame(time => {
            state.frame = 0;
            if (state.destroyed || state.motion.matches || dom.hidden || !state.visible) return;
            // 30 fps keeps the light stripe effect inexpensive on mobile.
            if (time - state.last >= 33 && chart.canvas?.clientWidth && chart.canvas?.clientHeight) {
                state.last = time;
                state.offset = (time / 65) % 24;
                chart.draw();
            }
            animate(chart, state);
        });
    }
    return {
        id: 'elapsed-progress-effects',
        afterInit(chart) {
            const state = {frame:0, last:0, offset:0, visible:!win.IntersectionObserver,
                motion:win.matchMedia('(prefers-reduced-motion: reduce)'), destroyed:false};
            state.resume = () => {
                if (state.frame) win.cancelAnimationFrame(state.frame);
                state.frame = 0;
                if (state.motion.matches) state.offset = 0;
                chart.draw();
                animate(chart, state);
            };
            state.motion.addEventListener('change', state.resume);
            dom.addEventListener('visibilitychange', state.resume);
            if (win.IntersectionObserver) {
                state.observer = new win.IntersectionObserver(entries => {
                    state.visible = entries[0].isIntersecting;
                    state.resume();
                });
                state.observer.observe(chart.canvas);
            }
            states.set(chart, state);
        },
        beforeDatasetsDraw(chart) {
            const area = chart.chartArea, state = states.get(chart), {x} = position(chart);
            if (!state || !area || !Number.isFinite(x)) return;
            const right = Math.min(area.right, Math.max(area.left, x));
            if (right <= area.left) return;
            const ctx = chart.ctx, height = area.bottom - area.top;
            ctx.save();
            ctx.beginPath(); ctx.rect(area.left, area.top, right-area.left, height); ctx.clip();
            ctx.fillStyle = 'rgba(231, 76, 60, 0.035)';
            ctx.fillRect(area.left, area.top, right-area.left, height);
            ctx.strokeStyle = 'rgba(231, 76, 60, 0.18)'; ctx.lineWidth = 6;
            ctx.setLineDash([]);
            for (let start = area.left-height-24+state.offset; start < right+24; start += 24) {
                ctx.beginPath(); ctx.moveTo(start, area.bottom); ctx.lineTo(start+height, area.top); ctx.stroke();
            }
            ctx.restore();
        },
        afterDraw(chart) {
            const state = states.get(chart);
            if (!state) return;
            const {id, annotation, x} = position(chart);
            const plugin = Chart.registry.getPlugin('annotation');
            // The site pins annotation 2.0.1. Use its actual rendered label bounds;
            // support the public replacement when that dependency is upgraded.
            const elements = plugin.getAnnotations?.(chart) || plugin._getState?.(chart)?.elements || [];
            const line = elements.find(element => element.options.id === id);
            const label = line?.label;
            if (label?.options.display && Number.isFinite(x) && chart.chartArea) {
                const from = label.y + label.height, to = chart.chartArea.top + 5;
                if (to > from + 2) {
                    const ctx = chart.ctx, head = Math.min(5, (to-from)/2);
                    ctx.save(); ctx.strokeStyle = annotation.borderColor; ctx.fillStyle = annotation.borderColor;
                    ctx.lineWidth = 1.7; ctx.setLineDash([]);
                    ctx.beginPath(); ctx.moveTo(x, from); ctx.lineTo(x, to-head); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(x-head, to-head); ctx.lineTo(x, to); ctx.lineTo(x+head, to-head); ctx.closePath(); ctx.fill();
                    ctx.restore();
                }
            }
            animate(chart, state);
        },
        afterDestroy(chart) {
            const state = states.get(chart);
            if (!state) return;
            state.destroyed = true;
            win.cancelAnimationFrame(state.frame);
            state.observer?.disconnect();
            state.motion.removeEventListener('change', state.resume);
            dom.removeEventListener('visibilitychange', state.resume);
            states.delete(chart);
        }
    };
}

export function formatBestRankRange(record) {
    if (!record || !Number.isFinite(record.startMs)) return '';
    const format = value => new Intl.DateTimeFormat('ko-KR', {
        timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
    }).format(value).replace(/\s/g, '').replace(/\.$/, '');
    const end = record.isActive ? '현재 · 진행중'
        : Number.isFinite(record.endMs) ? `${format(record.endMs)} 종료` : '종료일 미기록';
    return `(${format(record.startMs)} 시작 ~ ${end})`;
}
