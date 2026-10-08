const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function currentRecoveryGoals(groups, elapsedDays) {
    const days = Number.isFinite(elapsedDays) ? Math.max(0, elapsedDays) : 0;
    return groups.flatMap(group => {
        const stages = group.stages.filter(stage => Number.isFinite(stage.d) && stage.d > 0);
        if (!stages.length) return [];
        const index = stages.findIndex(stage => days < stage.d);
        const stage = index < 0 ? stages.at(-1) : stages[index];
        const from = index > 0 ? stages[index - 1].d : index < 0 ? stage.d : 0;
        return [{...group, stage, from, complete:index < 0, percent:Math.min(100, Math.floor(days / stage.d * 100))}];
    });
}

export function recoveryGoalsHtml(goals) {
    return `<details class="alcohol-risk-stack current-recovery-stack">
        <summary class="current-recovery-summary"><span>🌱 현재 회복 목표</span><small>신체 · 간 · 뇌</small></summary>
        <div class="current-recovery-content">
        ${goals.map(goal => `<article class="alcohol-dementia-risk-box current-recovery-goal" data-recovery-goal="${escape(goal.key)}">
            <div class="current-recovery-heading"><strong>${escape(goal.icon)} ${escape(goal.label)}</strong><span>${goal.complete ? '목표 달성' : `${goal.from}~${goal.stage.d}일 구간 · 진행 중`}</span></div>
            <div class="current-recovery-title">${escape(goal.stage.t)}</div>
            <p>${escape(goal.stage.desc)}</p>
            <div class="current-recovery-progress" role="progressbar" aria-label="${escape(goal.label)} ${goal.stage.d}일 목표까지의 금주 경과" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${goal.percent}"><span style="width:${goal.percent}%"></span><b>${goal.percent}%</b></div>
        </article>`).join('')}
        <p class="current-recovery-note">금주 경과에 따른 목표 안내입니다. 진행률은 금주 기간 기준이며 개인의 실제 회복 정도를 측정한 값은 아닙니다.</p>
        </div>
    </details>`;
}
