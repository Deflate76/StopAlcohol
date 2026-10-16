import {createSnake, turnSnake, stepSnake, DIRECTIONS} from './snake-engine.js?v=20261017-1';
import {installGameSession} from './game-session.js?v=20261017-1';
const el = id => document.getElementById(id), canvas = el('game'), ctx = canvas.getContext('2d');
let game = createSnake(), state = 'title', best = 0, elapsed = 0, accumulator = 0, last = 0, difficulty = 'normal', sound = false, audio;
function hud() {
    el('score').textContent = String(game.score).padStart(4,'0'); el('best').textContent = String(Math.max(best,game.score)).padStart(4,'0');
    el('level').textContent = String(1+Math.floor(game.score/50)).padStart(2,'0');
}
function overlay(title, text, button, settings = false) {
    el('overlayTitle').textContent = title; el('overlayText').textContent = text; el('startButton').textContent = button;
    el('difficultyLabel').hidden = !settings; el('overlay').hidden = false;
}
function beep() {
    if (!sound) return;
    try {audio ||= new (window.AudioContext || window.webkitAudioContext)(); void audio.resume();
        const tone = audio.createOscillator(), gain = audio.createGain(); tone.frequency.value = 560;
        gain.gain.setValueAtTime(.045,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.1);
        tone.connect(gain); gain.connect(audio.destination); tone.start(); tone.stop(audio.currentTime+.1);
    } catch { /* Sound is optional. */ }
}
function save(outcome) {return session.finish({score:game.score, round:1+Math.floor(game.score/50), lives:state === 'over' ? 0 : 1, outcome, duration:elapsed});}
function resetAccount() {game=createSnake(); state='title'; best=0; elapsed=0; accumulator=0; el('pauseButton').disabled=true; overlay('한 칸씩, 더 길게.','먹이를 모으고 벽과 몸을 피하세요.','게임 시작',true); hud(); draw();}
const session = installGameSession({gameId:'snake', title:'스네이크', onAccount:resetAccount,
    onBest:value => {best = value; hud();}, beforeLeave:() => {if (state==='playing'||state==='paused') {pause(true); void save('report_return'); state='over'; el('pauseButton').disabled=true; overlay('여기까지 기록',`${game.score}점 · 저장 상태를 아래에서 확인하세요.`,'다시 시작',true);}}});
function start() {
    if (!session.canPlay()) return;
    if (state === 'paused') return pause();
    if (state === 'playing') return;
    if (!session.beginRun()) return;
    game = createSnake(); difficulty = el('difficulty').value; state='playing'; elapsed=0; accumulator=0; last=performance.now();
    el('overlay').hidden=true; el('pauseButton').disabled=false; el('pauseButton').textContent='일시정지'; canvas.focus({preventScroll:true}); hud(); draw();
}
function pause(force = false) {
    if (!session.canPlay()) return;
    if (state==='playing') {state='paused'; game.queue=[]; overlay('잠시 쉬어가기','준비되면 이어서 플레이하세요.','계속하기'); el('pauseButton').textContent='계속하기';}
    else if (state==='paused' && !force) {state='playing'; accumulator=0; last=performance.now(); el('overlay').hidden=true; el('pauseButton').textContent='일시정지'; canvas.focus({preventScroll:true});}
}
function turn(direction) {if (session.canPlay() && state==='playing') turnSnake(game,direction);}
function draw() {
    ctx.fillStyle='#0c1c13'; ctx.fillRect(0,0,400,400); ctx.strokeStyle='#193020'; ctx.lineWidth=1;
    for(let i=20;i<400;i+=20){ctx.beginPath();ctx.moveTo(i,.5);ctx.lineTo(i,400);ctx.moveTo(.5,i);ctx.lineTo(400,i);ctx.stroke();}
    if(game.food){const {x,y}=game.food;ctx.fillStyle='#ffb869';ctx.beginPath();ctx.arc(x*20+10,y*20+11,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#b6df7b';ctx.fillRect(x*20+10,y*20+2,3,4);}
    game.body.forEach((p,i)=>{ctx.fillStyle=i?'#77bd66':'#c1f58b';ctx.fillRect(p.x*20+2,p.y*20+2,16,16);});
    const head=game.body[0], d=DIRECTIONS[game.direction]; ctx.fillStyle='#16321c';
    for(const side of [-1,1])ctx.fillRect(head.x*20+9+d.x*4+(d.y?side*4:0),head.y*20+9+d.y*4+(d.x?side*4:0),3,3);
}
function loop(time) {
    const dt=Math.min(100,Math.max(0,time-last));last=time;
    if(state==='playing' && session.canPlay()) {
        elapsed+=dt/1000;accumulator+=dt;
        const interval=Math.max(70,(difficulty==='easy'?230:165)-Math.floor(game.score/50)*12);
        if(accumulator>=interval){accumulator-=interval;const previous=game.score;stepSnake(game);if(game.score>previous)beep();
            if(game.state!=='playing'){state='over';best=Math.max(best,game.score);el('pauseButton').disabled=true;
                overlay(game.state==='won'?'모든 칸을 채웠어요!':'다시 한 판?',`${game.score}점 · 길이 ${game.body.length}칸`,'다시 시작',true);void save(game.state==='won'?'victory':'game_over');}
            hud();draw();}
    }
    requestAnimationFrame(loop);
}
el('startButton').addEventListener('click',start);el('pauseButton').addEventListener('click',()=>pause());
el('soundButton').addEventListener('click',()=>{sound=!sound;el('soundButton').textContent=sound?'소리 켬':'소리 끔';el('soundButton').setAttribute('aria-pressed',String(sound));beep();});
document.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('click',()=>turn(button.dataset.direction)));
const keyDirection={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};
window.addEventListener('keydown',event=>{if(!session.canPlay()||event.target.closest('input,select,textarea'))return;
    if(keyDirection[event.code]&&state==='playing'){event.preventDefault();if(!event.repeat)turn(keyDirection[event.code]);}
    if(['KeyP','Escape'].includes(event.code)&&!event.repeat){event.preventDefault();pause();}
    if(event.code==='Enter'&&!event.repeat&&event.target===canvas){event.preventDefault();start();}});
let point=null;
canvas.addEventListener('pointerdown',event=>{if(state!=='playing'||!event.isPrimary)return;point={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointermove',event=>{if(!point||point.id!==event.pointerId)return;const dx=event.clientX-point.x,dy=event.clientY-point.y;
    if(Math.max(Math.abs(dx),Math.abs(dy))<14)return;turn(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');point=null;});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{point=null;});
window.addEventListener('blur',()=>pause(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)pause(true);});
hud();draw();requestAnimationFrame(loop);
