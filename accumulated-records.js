const DAY = 86400000;
const validDuration = row => Number.isFinite(row.durationMs) && row.durationMs >= 0;
export const recordRankClass = rank => ({1:'rank-first', 2:'rank-second', 3:'rank-third'}[rank] || '');
export const recordRankColor = rank => ({1:'#c39a42', 2:'#879cae', 3:'#bb815c'}[rank] || '#438c75');

// Attempt order is chronological and independent of the table's selected sort.
// Invalid durations remain unknown rather than becoming a misleading zero-day record.
export function buildAccumulatedRecords(rows) {
    const chronological = [...rows].sort((a,b) => {
        const aTime = Number.isFinite(a.startMs) ? a.startMs : Infinity;
        const bTime = Number.isFinite(b.startMs) ? b.startMs : Infinity;
        return aTime - bTime || a.originalIndex - b.originalIndex;
    });
    const durations = rows.filter(validDuration).map(row => row.durationMs).sort((a,b) => b-a);
    const ranks = new Map(), counts = new Map();
    durations.forEach((duration,index) => {
        if (!ranks.has(duration)) ranks.set(duration,index+1);
        counts.set(duration,(counts.get(duration)||0)+1);
    });
    const max = durations[0] || 0;
    return chronological.map((row,index) => ({...row, attempt:index+1,
        durationRank:validDuration(row) ? ranks.get(row.durationMs) : null,
        tiedRank:validDuration(row) && counts.get(row.durationMs)>1,
        durationPercent:validDuration(row) && max>0 ? row.durationMs/max*100 : 0
    }));
}

export function accumulatedChartConfig(rows, {formatDuration, formatDate}) {
    const chronological = [...rows].sort((a,b) => a.attempt-b.attempt);
    return {
        type:'bar',
        data:{labels:chronological.map(row => `${row.attempt}회`), datasets:[{
            label:'유지기간', data:chronological.map(row => validDuration(row) ? row.durationMs/DAY : null),
            backgroundColor:chronological.map(row => recordRankColor(row.durationRank)),
            borderColor:chronological.map(row => row.isActive ? '#174e3b' : recordRankColor(row.durationRank)),
            borderWidth:chronological.map(row => row.isActive ? 2 : 0), borderRadius:4, maxBarThickness:36
        }]},
        options:{responsive:true, maintainAspectRatio:false, animation:false,
            interaction:{mode:'index',intersect:false},
            plugins:{legend:{display:false},tooltip:{callbacks:{
                title:items => `${chronological[items[0].dataIndex].attempt}번째 도전`,
                label:item => {
                    const row=chronological[item.dataIndex];
                    return [`유지 ${formatDuration(row.durationMs)}${row.isActive?' · 진행 중':''}`,
                        `${row.tiedRank?'공동 ':''}${row.durationRank}위`,
                        `${formatDate(row.startMs)} → ${row.isActive?'진행 중':formatDate(row.endMs)}`];
                }
            }}},
            scales:{
                x:{title:{display:true,text:'도전 횟수 (시작일 순)',color:'#60756a'},grid:{display:false},ticks:{color:'#60756a',maxTicksLimit:8,maxRotation:0,font:{size:10}}},
                y:{beginAtZero:true,title:{display:true,text:'유지기간 (일)',color:'#60756a'},grid:{color:'#e5ece7'},ticks:{color:'#60756a',maxTicksLimit:5,font:{size:10}}}
            }
        }
    };
}
