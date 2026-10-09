const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const fn=name=>{const a=source.indexOf(`    function ${name}(`);assert(a>=0,name);return source.slice(a,source.indexOf('\n    }',a)+6);};
function fixture(t) {
    const html=new JSDOM(source),modal=html.window.document.getElementById('calendarModal').outerHTML;html.window.close();
    const dom=new JSDOM(modal,{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
    const NativeDate=w.Date;
    w.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:['2026-10-09T12:00:00']));}static now(){return new NativeDate('2026-10-09T12:00:00').getTime();}};
    Object.assign(w,{allChallengesData:[],userQuitDate:null,currentChallengeId:null,currentCalDate:new w.Date(2026,8,1),
        globalBestStartDate:null,globalBestEndDate:null,globalMaxDays:0,cautionDays:[],dailyLogsData:{},hr:{entries:[]},
        dailySchedules:{paintCalendar(){}},calendarEnvironment:{render(){}},backgroundTask(){},
        getChallengeEntriesForDate:()=>[],hasCalendarDayUserInput:()=>false,openCalendarDayContentFromClick(){},handleHealthDayKey(){},
        renderFailureTimeRisk(){},updateCalendarMonthSuccessUI(){},updateCalendarMonthAlcoholCompareUI(){},updateCalendarMonthToDateAlcoholCompareUI(){},updateCalendarMedicationAlcoholCompareUI(){},
        clampFloatNumber:(value,min,max,fallback=0)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback
    });
    for(const name of ['dateToKey','formatDateShortKo','normalizeChallengeDoc','getChallengeRecordRange','getLongestChallengeRecord','refreshLongestChallengeRecord','getChallengeRecordBreak','formatAccumulatedDuration','getCalendarChallengeRanges','renderCalendarRecordBreakNotice','renderCalendar','findFailedChallengeByDate','getAlcoholRecordForDate','getAlcoholDayCellInlineStyle','appendInlineStyle'])w.eval(fn(name));
    const put=(id,start,end,status='failed')=>w.normalizeChallengeDoc(id,{startDate:start,endDate:end,status});
    w.allChallengesData=[put('early','2026-08-29T12:00:00','2026-09-03T12:00:00'),put('single','2026-09-10T09:00:00','2026-09-10T18:00:00'),put('best','2026-09-12T12:00:00','2026-09-28T12:00:00'),put('active','2026-10-01T12:00:00',null,'active')];
    w.currentChallengeId='active';w.userQuitDate='2026-10-01T12:00:00';
    const cell=date=>w.document.querySelector(`[data-date="${date}"]`);
    return {w,put,cell};
}

test('past attempts span month boundaries, retain start/end markers and leave gaps uncolored',t=>{
    const {w,cell}=fixture(t),toggle=w.document.getElementById('calCompactView');
    let clicked=0;toggle.addEventListener('click',()=>clicked++);
    w.renderCalendar(2026,8,'current');
    assert(cell('2026-09-01').classList.contains('range-past-mid'));
    assert(cell('2026-09-03').classList.contains('range-past-end'));
    assert.equal(cell('2026-09-03').querySelector('.cal-past-badge').textContent,'종료');
    assert(cell('2026-09-03').classList.contains('alcohol-day-mark'),'existing drinking color remains');
    assert(cell('2026-09-03').querySelector('.cal-track-past'),'challenge track coexists with drinking');
    assert.equal(cell('2026-09-04').querySelector('.cal-challenge-track'),null);
    assert(cell('2026-09-10').classList.contains('range-past-single'));
    assert.equal(cell('2026-09-10').querySelector('.cal-past-badge').textContent,'시작종료');
    assert(cell('2026-09-12').classList.contains('range-past-start'));
    assert.match(cell('2026-09-01').getAttribute('aria-label'),/2026.*08.*29.*2026.*09.*03/);
    w.renderCalendar(2026,7,'current');assert(cell('2026-08-29').classList.contains('range-past-start'));
    w.renderCalendar(2026,9,'current');assert(cell('2026-10-01').classList.contains('range-curr-start'));
    assert.equal(cell('2026-10-09').querySelector('.cal-range-badge').textContent,'진행중');
    assert.equal(cell('2026-10-10').querySelector('.cal-challenge-track'),null);
    assert.equal(w.document.getElementById('calCompactView'),toggle);toggle.click();assert.equal(clicked,1,'month renders preserve the view control and its handler');
});

test('longest mode keeps other past attempts and current attempts visible; a same-day restart takes priority',t=>{
    const {w,cell,put}=fixture(t);
    w.renderCalendar(2026,8,'longest');
    assert(cell('2026-09-12').classList.contains('range-best-start'));
    assert.equal(cell('2026-09-28').querySelector('.cal-range-badge').textContent,'종료');
    assert(cell('2026-09-01').classList.contains('range-past-mid'));
    w.renderCalendar(2026,9,'longest');assert(cell('2026-10-01').classList.contains('range-curr-start'));
    w.allChallengesData=w.allChallengesData.slice(0,1).concat(put('active','2026-09-03T15:00:00',null,'active'));
    w.userQuitDate='2026-09-03T15:00:00';w.renderCalendar(2026,8,'current');
    assert(cell('2026-09-03').classList.contains('range-curr-start'));
    assert.match(cell('2026-09-03').getAttribute('aria-label'),/현재 도전.*지난 도전/,'both overlapping ranges remain described');
});

test('invalid or missing recorded ends never create past ranges through today, and active ranges use the current time',t=>{
    const {w,put}=fixture(t);
    const rows=[put('no-end','2026-08-01',null),put('invalid','bad','2026-09-01'),put('reverse','2026-09-09','2026-09-01'),put('future','2027-01-01',null,'active'),put('active','2026-10-01','2026-10-02','active')];
    const result=w.getCalendarChallengeRanges(rows);
    assert.equal(result.length,1);assert.equal(result[0].id,'active');assert.equal(result[0].endKey,'2026-10-09');
});
