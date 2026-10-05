const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const modulePromise = import(pathToFileURL(path.join(root,'record-activity.js')));
const at = Date.parse('2026-10-05T12:00:00+09:00'), DAY = 86400000;
function extract(name, windowFunction = false) {
    const start = html.indexOf(windowFunction ? `    window.${name} = ` : `    function ${name}(`);
    const endToken = windowFunction ? '\n    };' : '\n    }';
    const end = html.indexOf(endToken,start);
    assert(start >= 0 && end > start);
    return html.slice(start,end+endToken.length);
}

test('activity uses save time in Korea, excludes yesterday and defaults, and keeps all actual categories', async () => {
    const {summarizeTodayActivity,koreaDayKey} = await modulePromise;
    assert.equal(koreaDayKey('2026-10-04T15:00:00Z'),'2026-10-05');
    const craving={timestamp:at-1000,reason:'회식',strength:7};
    const data={currentId:'active',challenges:[{id:'active',cravings:[craving]},{id:'old',cravings:[{timestamp:at-DAY,reason:'어제'}]}],
        cravings:[craving,{type:'state',timestamp:at,mood:0,fatigue:3},{type:'action',timestamp:at,actionName:'산책'},
            {type:'medication',timestamp:at-3*DAY,recordedAt:at,drugName:'기록약',dose:50}],
        bodyLogs:[{recordedAt:at,measuredAt:at-DAY,weight:70,height:175}],
        dailyLogs:{'2026-10-05':{updatedAt:at,breakfast:5,smoking:0,fieldRecordedAt:{breakfast:at-DAY,smoking:at}}},
        healthEntries:[{note:'오늘의 메모',updatedAt:{seconds:at/1000}}],cautions:[{date:'2026-10-10',reason:'모임 예정',timestamp:at}],
        controlSessions:[{updatedAt:at,drinksList:[{}]}]};
    const result=summarizeTodayActivity(data,at);
    assert.equal(result.entries.filter(e=>e.category==='craving').length,1,'active challenge entries are not duplicated');
    assert.deepEqual([...result.categories].sort(),['action','body','caution','control','craving','health','medication','smoking','state']);
    assert.match(result.text,/기분 0\/10/); assert.match(result.text,/70kg/); assert.match(result.text,/흡연량 0\/10/);
    assert(!result.text.includes('아침')); assert(!result.text.includes('어제'));
    assert.equal(summarizeTodayActivity(data,at+DAY).text,'');
    assert.equal(summarizeTodayActivity({dailyLogs:{today:{updatedAt:at,smoking:0,breakfast:0}}},at).text,'');
    assert.equal(summarizeTodayActivity({cravings:[{timestamp:at+DAY,reason:'미래'}]},at).text,'');
});

test('streak comparison separates the fixed gap from the live duration and survives sorting', async () => {
    const {compareStreakRecords,formatRecordDuration}=await modulePromise;
    const previous={ordinal:1,startMs:at-20*DAY,endMs:at-10*DAY,durationMs:10*DAY};
    const current={ordinal:2,isCurrent:true,isActive:true,startMs:at-5*DAY,durationMs:5*DAY};
    let value=compareStreakRecords([current,previous],at);
    assert.equal(value.gapMs,5*DAY); assert.equal(value.difference,-5*DAY);
    assert.equal(value.differenceText,'앞선 기록보다 5일 0시간 0분 0초 짧음');
    assert.match(compareStreakRecords([previous,current],at+1000).differenceText,/4일 23시간 59분 59초/);
    assert.match(compareStreakRecords([current,previous],at+5*DAY+1000).differenceText,/0일 0시간 0분 1초 더 유지/);
    assert.equal(compareStreakRecords([current],at),null);
    assert.equal(formatRecordDuration(DAY+3600000+60000+1000),'1일 1시간 1분 1초');
});

test('streak modal updates the existing cells and comparison every second without rebuilding rows', async t => {
    const m=await modulePromise;
    const dom=new JSDOM(html,{url:'https://fixture.invalid',runScripts:'outside-only'});t.after(()=>dom.window.close());
    const w=dom.window;w.document.getElementById('streakRecordsModal').hidden=false;
    Object.assign(w,{formatRecordDuration:m.formatRecordDuration,compareStreakRecords:m.compareStreakRecords,
        hrEl:id=>w.document.getElementById(id),streakRecordsRows:[
            {ordinal:1,startMs:at-20*DAY,endMs:at-10*DAY,durationMs:10*DAY},
            {ordinal:2,isCurrent:true,isActive:true,startMs:at-5*DAY,durationMs:5*DAY}],
        streakRecordsTargetDays:5,streakRecordsSort:{key:'ordinal',direction:'asc'},formatAccumulatedRecordDate:v=>String(v)});
    for(const name of ['refreshStreakLiveRows','renderStreakRecords'])w.eval(extract(name));
    w.renderStreakRecords();const node=w.document.querySelector('[data-streak-live]');
    w.refreshStreakLiveRows(at);assert.equal(node.textContent,'5일 0시간 0분 0초');
    w.refreshStreakLiveRows(at+1000);assert.equal(node.textContent,'5일 0시간 0분 1초');
    assert.equal(node,w.document.querySelector('[data-streak-live]'));
    assert.match(w.document.getElementById('streakDurationDifference').textContent,/4일 23시간 59분 59초/);
    assert.equal(w.document.querySelector('.streak-gap-row').nextElementSibling.className,'is-current');
});

test('floating craving disclosure manages focus, mutual exclusion, Escape, and original modal actions', t => {
    const dom=new JSDOM(html,{url:'https://fixture.invalid',runScripts:'outside-only'});t.after(()=>dom.window.close());
    const w=dom.window,d=w.document,opened=[],alerts=[];
    Object.assign(w,{userId:'owner',auth:{currentUser:{uid:'owner'}},currentChallengeId:'challenge',
        closeFloatingQuickNav(){},openModal:id=>opened.push(id),openActionModal:()=>opened.push('actionModal'),alert:text=>alerts.push(text)});
    w.eval(extract('openCravingQuickAction',true));
    w.eval(fs.readFileSync(path.join(root,'floating-actions.js'),'utf8'));
    d.getElementById('floatingActionToggle').click();d.getElementById('floatingCravingToggle').click();
    assert.equal(d.getElementById('floatingActionToggle').getAttribute('aria-expanded'),'false');
    assert.equal(d.getElementById('floatingCravingItems').inert,false);
    const button=d.getElementById('floatingCravingRecord');
    button.addEventListener('click',()=>{assert.equal(d.activeElement.id,'floatingCravingToggle');w.openCravingQuickAction('record');});
    button.focus();button.click();assert.deepEqual(opened,['cravingModal']);
    assert.equal(d.getElementById('floatingCravingItems').inert,true);
    w.openCravingQuickAction('action');assert.deepEqual(opened,['cravingModal','actionModal']);
    w.currentChallengeId=null;w.openCravingQuickAction('record');assert.equal(alerts.length,1);
    d.getElementById('floatingCravingToggle').click();
    d.getElementById('floatingCravingAction').focus();
    d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(d.activeElement.id,'floatingCravingToggle');
    assert.equal(d.getElementById('floatingCravingToggle').getAttribute('aria-expanded'),'false');
});
