const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path'),{JSDOM}=require('jsdom');
const controller=import(pathToFileURL(path.join(__dirname,'../section-selection.js')));

async function fixture(t) {
    const dom=new JSDOM(`<div id="displayArea">
      <section id="timerDisplaySection" class="inline-collapsible-section" data-collapsed="true"><button class="inline-collapsible-summary"><span>타이머</span></button><div>내용</div></section>
      <div id="dynamic"></div>
      <details id="sectionCraving" class="main-section"><summary><span>고비 관리</span></summary><div>내용</div></details>
      <details id="sectionStats" class="main-section"><summary><span>통계</span></summary><div>내용</div></details>
      <details id="sectionCommunity" class="main-section" open><summary>통신 <button id="unread">댓글</button></summary><details id="nested"><summary>검색</summary></details><button id="contentButton">본문</button></details>
    </div>`);
    t.after(()=>dom.window.close());const doc=dom.window.document,changes=[],events=[];let time=1000;
    doc.addEventListener('app:sectiontoggle',event=>events.push(event.detail));
    const ui=(await controller).installSectionSelection({doc,onToggle:(section,open)=>changes.push([section.id,open]),now:()=>time});
    const q=selector=>doc.querySelector(selector);
    const pointer=(type,target,options={})=>{
        const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:30,clientY:90,...options});
        Object.defineProperties(event,{pointerId:{value:options.pointerId??1},isPrimary:{value:options.isPrimary??true}});
        target.dispatchEvent(event);
    };
    const click=(target,detail=1)=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true,detail}));
    return {dom,doc,q,ui,changes,events,pointer,click,advance:ms=>{time+=ms;}};
}

test('a heading tap opens once and its compatibility click cannot toggle it back',async t=>{
    const f=await fixture(t),heading=f.q('#sectionCraving summary span');
    f.pointer('pointerdown',heading);f.pointer('pointerup',heading);f.click(heading);
    assert.equal(f.q('#sectionCraving').open,true);assert.equal(f.q('#sectionStats').open,false);
    assert.deepEqual(f.changes,[['sectionCraving',true]]);assert.deepEqual(f.events,[{id:'sectionCraving',open:true}]);
});

test('a layout shift between press and release opens the original section, never the lower section',async t=>{
    const f=await fixture(t),original=f.q('#sectionCraving summary'),lower=f.q('#sectionStats summary');
    f.pointer('pointerdown',original);f.pointer('pointerup',lower);f.click(lower);
    assert.equal(f.q('#sectionCraving').open,true);assert.equal(f.q('#sectionStats').open,false);
    assert.deepEqual(f.changes,[['sectionCraving',true]]);
});

test('a live summary replacement retains the pressed section ID',async t=>{
    const f=await fixture(t);f.q('#dynamic').innerHTML='<section id="activeRecoverySummary" class="inline-collapsible-section" data-collapsed="true"><button class="inline-collapsible-summary">누적</button></section>';
    f.pointer('pointerdown',f.q('#activeRecoverySummary button'));
    f.q('#activeRecoverySummary').outerHTML='<section id="activeRecoverySummary" class="inline-collapsible-section" data-collapsed="true"><button class="inline-collapsible-summary">새 누적</button></section>';
    f.pointer('pointerup',f.q('#sectionCraving summary'));f.click(f.q('#sectionCraving summary'));
    assert.equal(f.q('#activeRecoverySummary').dataset.collapsed,'false');assert.equal(f.q('#sectionCraving').open,false);
    assert.equal(f.q('#activeRecoverySummary button').getAttribute('aria-expanded'),'true');
});

test('scroll drags, pointer cancellation and long presses do not activate headings',async t=>{
    for(const mode of ['drag','cancel','hold','contextmenu']) {
        const f=await fixture(t),heading=f.q('#sectionCraving summary');f.pointer('pointerdown',heading);
        if(mode==='drag')f.pointer('pointermove',heading,{clientY:120});
        if(mode==='cancel')f.pointer('pointercancel',heading);
        if(mode==='hold')f.advance(800);
        if(mode==='contextmenu')heading.dispatchEvent(new f.dom.window.Event('contextmenu',{bubbles:true}));
        f.pointer('pointerup',heading);f.click(heading);
        assert.equal(f.q('#sectionCraving').open,false,mode);assert.equal(f.changes.length,0,mode);
    }
});

test('keyboard/assistive clicks toggle inline and native sections exactly once',async t=>{
    const f=await fixture(t),timer=f.q('#timerDisplaySection button'),stats=f.q('#sectionStats summary');
    let legacyCalls=0;timer.addEventListener('click',()=>{legacyCalls++;});
    timer.click();assert.equal(f.q('#timerDisplaySection').dataset.collapsed,'false');
    timer.click();assert.equal(f.q('#timerDisplaySection').dataset.collapsed,'true');
    stats.click();assert.equal(f.q('#sectionStats').open,true);
    stats.click();assert.equal(f.q('#sectionStats').open,false);
    assert.equal(legacyCalls,0);assert.equal(f.changes.length,4);
});

test('nested summaries and buttons retain their own actions without toggling their main section',async t=>{
    const f=await fixture(t);let unread=0,content=0;
    f.q('#unread').addEventListener('click',()=>unread++);f.q('#contentButton').addEventListener('click',()=>content++);
    for(const target of [f.q('#unread'),f.q('#contentButton'),f.q('#nested summary')]) {
        f.pointer('pointerdown',target);f.pointer('pointerup',target);f.click(target);
    }
    assert.equal(unread,1);assert.equal(content,1);assert.equal(f.q('#nested').open,true);
    assert.equal(f.q('#sectionCommunity').open,true);assert.equal(f.changes.length,0);
});

test('a new pointer gesture clears suppression from a cancelled gesture',async t=>{
    const f=await fixture(t),heading=f.q('#sectionCraving summary');f.pointer('pointerdown',heading);f.pointer('pointercancel',heading);
    f.pointer('pointerdown',heading);f.pointer('pointerup',heading);f.click(heading);
    assert.equal(f.q('#sectionCraving').open,true);assert.equal(f.changes.length,1);
});
