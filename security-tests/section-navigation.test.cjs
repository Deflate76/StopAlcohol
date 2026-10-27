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

test('footer tap closes only its section and returns focus and view to its heading',async t=>{
    const f=await fixture(t),section=f.q('#sectionCraving'),heading=f.q('#sectionCraving > summary');
    section.open=true;let scrolled=0;heading.scrollIntoView=options=>{assert.equal(options.block,'start');scrolled++;};
    const close=f.q('#sectionCraving > .section-close-footer button');
    assert.equal(close.type,'button');assert.equal(close.getAttribute('aria-controls'),'sectionCraving');
    assert.equal(close.getAttribute('aria-label'),'고비 관리 접기');
    f.pointer('pointerdown',close);f.pointer('pointerup',close);
    // The now-hidden footer can leave a different section under the pointer.
    f.click(f.q('#sectionStats > summary'));
    assert.equal(section.open,false);assert.equal(f.q('#sectionStats').open,false);
    assert.equal(f.doc.activeElement,heading);assert(scrolled>=1);
    assert.deepEqual(f.changes,[['sectionCraving',false]]);
    assert.deepEqual(f.events,[{id:'sectionCraving',open:false}]);
});

test('keyboard footer activation collapses inline sections idempotently and keeps their content',async t=>{
    const f=await fixture(t),section=f.q('#timerDisplaySection'),heading=f.q('#timerDisplaySection > button');
    section.dataset.collapsed='false';heading.setAttribute('aria-expanded','true');
    const input=f.doc.createElement('input');input.value='unsaved draft';section.children[1].append(input);
    const close=f.q('#timerDisplaySection > .section-close-footer button');
    close.click();close.click();
    assert.equal(section.dataset.collapsed,'true');assert.equal(heading.getAttribute('aria-expanded'),'false');
    assert.equal(input.value,'unsaved draft');assert(input.isConnected);assert.equal(f.doc.activeElement,heading);
    assert.deepEqual(f.changes,[['timerDisplaySection',false]]);
    assert.equal(f.q('#nested .section-close-button'),null,'nested community controls do not acquire parent footers');
});

test('refresh adds one footer to dynamic sections and retains the intended close action across replacement',async t=>{
    const f=await fixture(t),markup='<section id="activeRecoverySummary" class="inline-collapsible-section" data-collapsed="false"><button class="inline-collapsible-summary">누적</button><div>기록</div></section>';
    f.q('#dynamic').innerHTML=markup;f.ui.refresh();f.ui.refresh();
    assert.equal(f.q('#activeRecoverySummary').querySelectorAll('.section-close-footer').length,1);
    const close=f.q('#activeRecoverySummary .section-close-button');f.pointer('pointerdown',close);
    f.q('#dynamic').innerHTML=markup;f.ui.refresh();
    f.pointer('pointerup',f.q('#sectionStats summary'));f.click(f.q('#sectionStats summary'));
    assert.equal(f.q('#activeRecoverySummary').dataset.collapsed,'true');assert.equal(f.q('#sectionStats').open,false);
    assert.deepEqual(f.changes,[['activeRecoverySummary',false]]);
    assert.equal(f.q('#activeRecoverySummary').querySelectorAll('.section-close-footer').length,1);
});

test('scrolling or cancelling a gesture on the footer does not close a section',async t=>{
    for(const mode of ['drag','cancel','hold']) {
        const f=await fixture(t),section=f.q('#sectionCraving'),close=f.q('#sectionCraving .section-close-button');section.open=true;
        f.pointer('pointerdown',close);
        if(mode==='drag')f.pointer('pointermove',close,{clientY:150});
        if(mode==='cancel')f.pointer('pointercancel',close);
        if(mode==='hold')f.advance(800);
        f.pointer('pointerup',close);f.click(close);
        assert.equal(section.open,true,mode);assert.equal(f.changes.length,0,mode);
    }
});

test('a footer touch suppresses synthetic focus changes but leaves the next deliberate press alone',async t=>{
    const f=await fixture(t),section=f.q('#sectionCraving'),heading=f.q('#sectionCraving > summary'),close=f.q('#sectionCraving .section-close-button');
    section.open=true;f.pointer('pointerdown',close);f.pointer('pointerup',close);
    const lower=f.q('#sectionStats > summary');
    const mouse=()=>new f.dom.window.MouseEvent('mousedown',{bubbles:true,cancelable:true});
    const compatibility=mouse();lower.dispatchEvent(compatibility);assert.equal(compatibility.defaultPrevented,true);
    lower.focus();f.click(lower);assert.equal(f.doc.activeElement,heading);assert.equal(f.q('#sectionStats').open,false);
    f.pointer('pointerdown',lower);const intentional=mouse();lower.dispatchEvent(intentional);
    assert.equal(intentional.defaultPrevented,false);
    f.pointer('pointerup',lower);f.click(lower);assert.equal(f.q('#sectionStats').open,true);
});
