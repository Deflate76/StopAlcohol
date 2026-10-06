const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const health = import(pathToFileURL(path.join(root, 'daily-health-tools.js')));
const density = import(pathToFileURL(path.join(root, 'progress-chart.js')));
const now = new Date(2026, 9, 7, 12).getTime();
const entry = (hour, minute = 0) => ({strength:5, reason:'갈망', timestamp:new Date(2026, 9, 6, hour, minute).getTime()});

test('craving percentages use all attempts once, with the live current list overriding stale history', async () => {
    const {cravingTimeStats} = await health;
    const result = cravingTimeStats({currentId:'current', challenges:[
        {id:'past', cravings:[entry(0),entry(1,59)]},
        {id:'current', cravings:[entry(0),entry(10)]}
    ], cravings:[entry(20),entry(23,59)]}, now);
    assert.equal(result.total,4);
    assert.equal(result.counts[0],2); assert.equal(result.counts[10],1); assert.equal(result.counts[11],1);
    assert.equal(result.counts[5],0,'deleted current entries are not resurrected from the history cache');
    assert.equal(result.percentages[0],50); assert.equal(result.percentages[10],25);
    assert.equal(result.percentages.reduce((a,b)=>a+b,0),100);
    const boundaries = cravingTimeStats({cravings:Array.from({length:24},(_,h)=>entry(h))},now);
    assert.deepEqual(boundaries.counts,Array(12).fill(2));
});

test('only timestamped craving events count; saving later and non-craving types never shift the time distribution', async () => {
    const {cravingTimeStats} = await health;
    const timestamp = entry(6).timestamp;
    const result = cravingTimeStats({cravings:[
        {...entry(4),recordedAt:entry(20).timestamp},
        {strength:4,timestamp:new Date(timestamp)},
        {type:'craving',strength:2,timestamp:{seconds:timestamp/1000}},
        {strength:2,timestamp:{toMillis:()=>timestamp}},
        {strength:2,timestamp:new Date(timestamp).toISOString()},
        ...['action','state','eval','medication'].map(type=>({...entry(12),type})),
        {strength:4,recordedAt:timestamp}, {strength:4,timestamp:'2026-10-06'},
        {strength:4,timestamp:'invalid'}, {strength:4,timestamp:now+1}, null, {},
    ]},now);
    assert.equal(result.total,5); assert.equal(result.skipped,4);
    assert.equal(result.counts[2],1); assert.equal(result.counts[3],4); assert.equal(result.counts[10],0);
    assert.deepEqual(cravingTimeStats({},now).percentages,Array(12).fill(0));
});

test('time arrows identify their exact bins, expose counts by tap/keyboard, and clear on reset/loading/errors', async t => {
    const {renderCravingTimeRisk} = await health;
    const dom = new JSDOM('<div id="subCravingMarkers"></div><p id="subCravingSummary"></p>');
    t.after(()=>dom.window.close()); const d=dom.window.document, track=d.getElementById('subCravingMarkers'), summary=d.getElementById('subCravingSummary');
    renderCravingTimeRisk(d,{cravings:[entry(0),entry(0),entry(23)]},{nowMs:now});
    assert(!track.hidden); assert.equal(track.children.length,2);
    const last=track.lastElementChild;
    assert(Math.abs(parseFloat(last.querySelector('.sub-craving-arrow').style.left)-95.83333333)<1e-6);
    assert.match(last.querySelector('button').getAttribute('aria-label'),/22~24시.*1\/3건 \(33.3%\)/);
    last.querySelector('button').click(); assert.match(summary.textContent,/22~24시.*33.3%/);
    for(const options of [{loading:true},{error:true},{}]) {
        renderCravingTimeRisk(d,{},options); assert(track.hidden); assert.equal(track.children.length,0); assert(!summary.textContent.includes('33.3%'));
    }
    renderCravingTimeRisk(d,{cravings:[entry(0),...Array.from({length:2000},()=>entry(2))]},{nowMs:now});
    assert.equal(track.querySelector('button').textContent,'<0.1%','a real rare event must not appear as zero');
});

test('the normalized example keeps its original shape and has 100% total area, including its long tail', async () => {
    const {distributionDensityPercent:f,distributionDayProbabilityPercent:day} = await density;
    const raw = t => Math.exp(-(Math.log((t+1)/15)**2)/(2*.8**2))/(t+5);
    for(const t of [0,1,10,25,100,1000]) assert(Math.abs(f(t)/f(10)-raw(t)/raw(10))<1e-10);
    // Independent Simpson integral in logarithmic day coordinates, from zero to an effectively infinite tail.
    const n=8000, lower=Math.log(1/15), upper=12, step=(upper-lower)/n;
    const transformed=u=>f(Math.max(0,15*Math.exp(u)-1))*15*Math.exp(u);
    let area=transformed(lower)+transformed(upper);
    for(let i=1;i<n;i++) area+=(i%2?4:2)*transformed(lower+i*step);
    assert(Math.abs(area*step/3-100)<1e-8);
    assert(day(10)>0&&day(10)<100); assert.equal(day(10.9),day(10));
    // Independently evaluated with adaptive quadrature over [0, 1].
    assert(Math.abs(day(0)-.20934539710276137)<1e-7);
    const visible=Array.from({length:100},(_,i)=>day(i)).reduce((a,b)=>a+b,0);
    assert(visible>98&&visible<100,'a finite visible range does not pretend to include the full tail');
    for(const invalid of [-1,NaN,Infinity]) {assert.equal(f(invalid),0);assert.equal(day(invalid),0);}
});

test('the actual distribution chart uses percent ticks and distinguishes density from one-day probability', async () => {
    const {distributionDensityPercent,distributionDayProbabilityPercent}=await density;
    const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const start=source.indexOf('    function initDistributionChart()');
    const fn=source.slice(start,source.indexOf('\n    }',start)+6);
    const reading={hidden:true,textContent:''};
    const config=new Function('Chart','document','goalGapBadgePlugin','currentPositionBadgePlugin','progressChartPlugin','currentPositionBadgeYAdjust','createGoalGapAnnotations','distributionDayProbabilityPercent',
        `let distChart; ${fn}; initDistributionChart(); return distChart;`)(function(_,config){return config;},{getElementById:id=>id==='distributionReading'?reading:{getContext:()=>({})}},{},{},{},()=>0,()=>({}),distributionDayProbabilityPercent);
    assert.match(config.options.scales.y.title.text,/%\/일/);
    assert.equal(config.options.scales.y.ticks.callback(2.5),'2.5%');
    const tooltip=config.options.plugins.tooltip.callbacks, item={parsed:{x:10.7,y:distributionDensityPercent(10.7)}};
    assert.match(tooltip.label(item),/확률밀도: .*%\/일 \(예시\)/);
    assert.match(tooltip.afterLabel(item),/10~11일 사이 확률: .*%/);
    config.options.plugins.tooltip.external({tooltip:{opacity:1,title:['경과 10.7일'],body:[{lines:[tooltip.label(item)],after:[tooltip.afterLabel(item)]}]}});
    assert.equal(reading.hidden,false); assert.match(reading.textContent,/10~11일 사이 확률/);
    const selected=reading.textContent;
    config.options.plugins.tooltip.external({tooltip:{opacity:0}});
    assert.equal(reading.hidden,false); assert.equal(reading.textContent,selected,'touchend/mouseout must not immediately erase the selected values');
});
