const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const modulePromise=import(pathToFileURL(path.join(root,'calendar-navigation.js')));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function fixture(t,{saved,storageBlocked=false}={}) {
    const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const toolbar=html.match(/<div class="cal-view-toolbar">[\s\S]*?<span id="calViewStatus"[\s\S]*?<\/span>\s*<\/div>/)[0];
    const dom=new JSDOM(`<div id="calendarModal">${toolbar}<div id="calendarDaysGrid"><div class="cal-day" data-date="2026-10-04" role="button" tabindex="0">4</div></div></div>`,{url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());
    const win=dom.window,doc=win.document,grid=doc.getElementById('calendarDaysGrid'),day=grid.firstElementChild;
    Object.defineProperty(grid,'clientWidth',{value:300});
    if(saved)win.localStorage.setItem('alcoholaway-calendar-view',saved);
    if(storageBlocked)Object.defineProperty(win,'localStorage',{get(){throw new Error('Storage disabled');}});
    const navigations=[];let time=0,cancelled=0,clicks=0;
    day.addEventListener('click',()=>clicks++);
    const {installCalendarNavigation}=await modulePromise;
    const ui=installCalendarNavigation({document:doc,window:win,now:()=>time,navigate:offset=>navigations.push(offset),cancelPress:()=>cancelled++});
    const pointer=(type,x,y,extra={},target=day)=>{
        const event=new win.Event(type,{bubbles:true,cancelable:true});
        for(const [key,value] of Object.entries({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,...extra}))Object.defineProperty(event,key,{value});
        target.dispatchEvent(event);return event;
    };
    const click=(detail=1)=>day.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true,detail}));
    return {ui,doc,win,grid,day,navigations,pointer,click,time:value=>time=value,cancelled:()=>cancelled,clicks:()=>clicks};
}

test('left/right swipe changes one month, blocks the generated click, and allows the next tap',async t=>{
    const f=await fixture(t);
    f.pointer('pointerdown',250,40);f.time(70);f.pointer('pointermove',170,44);f.time(150);f.pointer('pointerup',80,45);await tick();
    assert.deepEqual(f.navigations,[1]);assert(f.cancelled()>0);
    f.click();assert.equal(f.clicks(),0);
    f.pointer('pointerdown',80,45);f.pointer('pointerup',80,45);f.click();assert.equal(f.clicks(),1);
    f.pointer('pointerdown',80,45);f.time(200);f.pointer('pointermove',170,40);f.time(300);f.pointer('pointerup',250,42);await tick();
    assert.deepEqual(f.navigations,[1,-1]);
    f.pointer('pointerup',250,42);await tick();assert.equal(f.navigations.length,2,'one navigation per gesture');
});

test('horizontal touch movement cancels native fling and waits for touchend before replacing date nodes',async t=>{
    const f=await fixture(t);
    const touch=(type,count)=>{
        const event=new f.win.Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'touches',{value:Array(count).fill({})});
        f.day.dispatchEvent(event);return event;
    };
    f.pointer('pointerdown',250,40);f.time(70);f.pointer('pointermove',170,44);
    assert.equal(touch('touchmove',1).defaultPrevented,true);
    assert.equal(touch('touchmove',2).defaultPrevented,false,'pinch zoom is not suppressed');
    f.pointer('pointerup',80,45,{pointerType:'touch'});await tick();assert.deepEqual(f.navigations,[]);
    touch('touchend',0);await tick();assert.deepEqual(f.navigations,[1]);
    f.pointer('pointerdown',80,45);f.pointer('pointermove',82,130);
    assert.equal(touch('touchmove',1).defaultPrevented,false,'vertical scrolling remains native');
    f.pointer('pointerup',82,130);await tick();assert.deepEqual(f.navigations,[1]);
});

test('vertical scrolling, diagonal gestures, short drags, long presses and cancellation never change months',async t=>{
    const f=await fixture(t);
    for(const [x,y] of [[3,100],[65,75],[25,0]]) {
        f.time(0);f.pointer('pointerdown',100,100);f.time(100);f.pointer('pointermove',100+x,100+y);f.pointer('pointerup',100+x,100+y);
    }
    f.time(0);f.pointer('pointerdown',200,100);f.time(700);f.pointer('pointermove',80,100);f.pointer('pointerup',80,100);
    f.time(0);f.pointer('pointerdown',200,100);f.time(100);f.pointer('pointermove',80,100);f.pointer('pointercancel',80,100);f.pointer('pointerup',80,100);
    await tick();
    assert.deepEqual(f.navigations,[]);
    f.time(0);f.pointer('pointerdown',100,100);f.time(700);f.pointer('pointerup',100,100);
    await tick();
    assert.deepEqual(f.navigations,[]);
});

test('multi-touch and lost focus cancel a swipe; keyboard clicks and right buttons are untouched',async t=>{
    const f=await fixture(t);
    f.pointer('pointerdown',200,100);f.time(100);f.pointer('pointermove',100,100);
    f.pointer('pointerdown',250,100,{pointerId:2,isPrimary:false},f.doc.body);f.pointer('pointerup',80,100);
    await tick();
    assert.deepEqual(f.navigations,[]);
    f.pointer('pointerdown',200,100);f.pointer('pointermove',100,100);f.win.dispatchEvent(new f.win.Event('blur'));f.pointer('pointerup',80,100);
    await tick();
    assert.deepEqual(f.navigations,[]);
    f.click(0);assert.equal(f.clicks(),1,'keyboard activation survives a cancelled gesture');
    f.pointer('pointerdown',200,100,{button:2});f.pointer('pointermove',100,100);f.pointer('pointerup',80,100);
    await tick();
    assert.deepEqual(f.navigations,[]);
});

test('compact/detail selection restores and persists without affecting the date nodes',async t=>{
    const f=await fixture(t,{saved:'compact'});
    assert(f.ui.isCompact());assert.equal(f.doc.getElementById('calCompactView').getAttribute('aria-pressed'),'true');
    f.doc.getElementById('calDetailView').click();assert(!f.ui.isCompact());
    assert.equal(f.win.localStorage.getItem('alcoholaway-calendar-view'),'detail');
    f.doc.getElementById('calCompactView').click();assert(f.ui.isCompact());
    assert.equal(f.win.localStorage.getItem('alcoholaway-calendar-view'),'compact');
    assert.equal(f.grid.firstElementChild,f.day,'view changes preserve date records and listeners');
    f.click();assert.equal(f.clicks(),1);
});

test('view controls work when local storage is unavailable or contains an unknown value',async t=>{
    const f=await fixture(t,{storageBlocked:true});assert(!f.ui.isCompact());
    f.doc.getElementById('calCompactView').click();assert(f.ui.isCompact());
    const other=await fixture(t,{saved:'unexpected'});assert(!other.ui.isCompact());
});
