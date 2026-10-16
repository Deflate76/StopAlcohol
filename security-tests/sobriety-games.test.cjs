const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),mod=file=>import(pathToFileURL(path.join(root,file)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('sobriety rate includes Korean calendar dates and gaps from the first post-account challenge, deduplicates real alcohol days',async()=>{
    const {calculateSobrietyRate:rate,koreanDay}=await mod('sobriety-metrics.js');
    const data={createdAt:'2026-10-01T00:00:00+09:00',now:'2026-10-10T23:59:59+09:00',challenges:[
        {startDate:'2026-09-01',endDate:'2026-09-10',status:'failed',failAmount:3},
        {startDate:'2026-10-02',endDate:'2026-10-03',status:'failed',failAmount:5},
        {startDate:'2026-10-06',endDate:'2026-10-07',status:'failed',failReason:'과거 기록 이어하기로 전환'},
        {startDate:'2026-10-09',status:'active'},{startDate:'2026-11-01',status:'active'}],
        dailyLogs:{'2026-10-01':{alcohol:8},'2026-10-03':{alcohol:5},'2026-10-05':{alcohol:2},'2026-10-04':{alcohol:0},'2026-10-11':{alcohol:7}},
        controlSessions:[{drinksList:[{alcoholGrams:10,drinkStartedAt:'2026-10-05T15:00:00Z'},
            {alcoholGrams:0,drinkStartedAt:'2026-10-08'},{alcoholGrams:20,drinkStartedAt:'2026-10-05T14:00:00Z'}]}]};
    assert.deepEqual(rate(data),{startDate:'2026-10-02',totalDays:9,drinkingDays:3,soberDays:6,percent:67});
    assert.equal(koreanDay('2026-10-05T15:00:00Z'),koreanDay('2026-10-06'));
    assert.equal(koreanDay('2026-02-30'),null);
    assert.equal(rate({...data,createdAt:null}).percent,null);
    assert.equal(rate({...data,challenges:[]}).percent,null);
    assert.equal(rate({createdAt:'2026-10-10',challenges:[{startDate:'2026-10-10'}],now:'2026-10-10'}).percent,100);
    assert.equal(rate({createdAt:'2026-10-10',challenges:[{startDate:'2026-10-10'}],dailyLogs:{'2026-10-10':{alcohol:1}},now:'2026-10-10'}).percent,0);
    assert.equal(rate({...data,dailyLogs:{},controlSessions:[]}).drinkingDays,1,'cleared daily records no longer count');
});

test('previous best remains fixed at exact duration and excludes overlapping, active, invalid and current attempts',async()=>{
    const {previousBestDays:best}=await mod('sobriety-metrics.js');
    const rows=[{id:'old',startDate:'2026-09-01T00:00Z',endDate:'2026-09-11T12:00Z',status:'failed'},
        {id:'self',startDate:'2026-09-15',endDate:'2026-10-30',status:'active'},
        {id:'overlap',startDate:'2026-01-01',endDate:'2026-09-16'},
        {id:'missing',startDate:'2026-01-01',endDate:'2026-09-12',hasRecordedEndDate:false}];
    assert.equal(best(rows,'self','2026-09-15'),10.5);assert.equal(best([],'self','2026-09-15'),null);assert.equal(best(rows,'self',null),null);
});

test('new record stripes occupy only the exact previous-best/current interval inside the curve; reduced motion schedules no frames',async()=>{
    const {createProgressChartPlugin}=await mod('progress-chart.js');
    for(const id of ['survivalChart','distributionChart']) {
        const ops=[],ctx=new Proxy({},{get:(obj,key)=>obj[key]||((...args)=>ops.push([key,...args])),set:(obj,key,value)=>{obj[key]=value;ops.push([key,value]);return true;}});
        let frames=0;const win={matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),requestAnimationFrame:()=>++frames,cancelAnimationFrame(){}};
        const dom={hidden:false,addEventListener(){},removeEventListener(){}};
        const line={first:()=>({x:10,y:20}),last:()=>({x:80,y:65}),updateControlPoints(){},path(){ops.push(['actual-curve']);}};
        const chart={canvas:{id},options:{plugins:{annotation:{annotations:{line1:{xMin:7},myPosition:{xMin:7}}}}},scales:{x:{getPixelForValue:v=>10+v*10}},chartArea:{left:10,right:110,top:20,bottom:100},ctx,
            getDatasetMeta:()=>({dataset:line}),isDatasetVisible:()=>true,$previousBestDays:4.5,draw(){}};
        const p=createProgressChartPlugin({registry:{getPlugin:()=>({})}},win,dom);p.afterInit(chart);p.beforeDatasetsDraw(chart);p.afterDraw(chart);
        assert(ops.some(o=>o[0]==='actual-curve'));assert(ops.some(o=>o[0]==='rect'&&o[1]===55&&o[3]===25));
        assert(ops.some(o=>o[0]==='strokeStyle'&&o[1]==='rgba(109, 40, 217, 0.65)'));assert.equal(frames,0);
        ops.length=0;chart.$previousBestDays=7;p.beforeDatasetsDraw(chart);
        assert(!ops.some(o=>o[0]==='strokeStyle'&&o[1].includes('109, 40')),'a tie is not a new record');p.afterDestroy(chart);
    }
});

test('diagnosis picker filters recovered/future diagnoses, opens a single choice directly, and rechecks changed records and accounts',async()=>{
    const {activeDiagnosisChoices,installQuickActions}=await mod('quick-actions.js');
    const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const dom=new JSDOM(source),d=dom.window.document;
    for(const id of ['quickDiagnosisDialog','gamePickerDialog']) {const el=d.getElementById(id);el.showModal=()=>{el.open=true;};el.close=()=>{el.open=false;};}
    const valid=v=>/^2026-\d\d-\d\d$/.test(v),recovered=v=>v.recoveredDate;
    const entries=[{id:'entry',diagnoses:[{id:'a',name:'<img src=x>',date:'2026-10-01'},{id:'b',name:'간',date:'2026-10-02'},
        {id:'c',name:'회복됨',date:'2026-10-01',recoveredDate:'2026-10-05'},{id:'future',name:'미래',date:'2026-11-01'}]}];
    const choices=activeDiagnosisChoices(entries,'2026-10-17',valid,recovered);assert.equal(choices.length,2);
    let owner='one',state={choices},opened=[];const ui=installQuickActions({document:d,account:()=>owner,health:()=>state,openDiary:(...args)=>opened.push(args),newDiagnosis(){}});
    ui.openDiagnoses();assert.equal(d.querySelectorAll('#quickDiagnosisList button').length,2);assert.equal(d.querySelector('#quickDiagnosisList img'),null);
    const stale=d.querySelector('#quickDiagnosisList button');state={choices:[]};stale.click();assert.equal(opened.length,0);
    state={choices:[choices[0]]};ui.openDiagnoses();assert.deepEqual(opened,[['entry',1]]);assert(!d.getElementById('quickDiagnosisDialog').open);
    state={choices};ui.openDiagnoses();owner='two';d.querySelector('#quickDiagnosisList button').click();assert.equal(opened.length,1);assert(!d.getElementById('quickDiagnosisDialog').open);
    ui.openGames();assert(d.getElementById('gamePickerDialog').open);ui.close();assert(!d.getElementById('gamePickerDialog').open);dom.window.close();
});

test('game account gates play, isolates histories, ignores late account replies, and retries the same score document',async()=>{
    const {createGameAccount}=await mod('games/game-account.js');let auth,reads=[],writes=[],history=[],userUpdates=[];
    const account=createGameAccount({gameId:'snake',gameTitle:'스네이크',watchAuth:cb=>{auth=cb;return()=>{};},
        readScores:(uid,gameId)=>{const d=deferred();reads.push({uid,gameId,...d});return d.promise;},
        writeScore:(uid,id,payload)=>{const d=deferred();writes.push({uid,id,payload,...d});return d.promise;},
        onAccount:user=>userUpdates.push(user?.uid),onHistory:(rows,best)=>history.push({rows,best}),onStatus(){},uuid:()=>String(writes.length+1),now:()=>100});
    assert.equal(account.beginRun(),false);auth({uid:'a'});assert(account.beginRun());
    const save=account.finish({score:40,round:2});await tick();assert.equal(writes[0].uid,'a');assert.equal(writes[0].payload.gameId,'snake');
    writes[0].reject(Error('offline'));assert.equal(await save,false);const retry=account.retry();await tick();assert.equal(writes[1].id,writes[0].id);writes[1].resolve();assert(await retry);
    auth({uid:'b'});assert.equal(account.canPlay(),true);
    reads[0].resolve([{gameId:'snake',score:999,playedAt:10}]);await tick();assert.equal(history.at(-1).best,0);
    reads.at(-1).resolve([{gameId:'pickman',score:9999,playedAt:99},{gameId:'snake',score:20,playedAt:20}]);await tick();assert.equal(history.at(-1).best,20);assert.equal(history.at(-1).rows.length,1);
    assert(account.beginRun());const late=account.finish({score:50});await tick();auth(null);assert(!account.canPlay());assert.equal(account.beginRun(),false);
    writes.at(-1).resolve();await late;assert.equal(history.at(-1).best,0);assert.equal(writes.at(-1).uid,'b');account.dispose();
});

test('snake prevents reversals, queues valid corner turns, permits a vacated tail, and ends on walls, itself or a full board',async()=>{
    const {createSnake,turnSnake,stepSnake,placeFood}=await mod('games/snake-engine.js');
    const game=createSnake(20,()=>0);assert(!game.body.some(p=>p.x===game.food.x&&p.y===game.food.y));
    assert(!turnSnake(game,'left'));assert(turnSnake(game,'up'));assert(!turnSnake(game,'down'));assert(turnSnake(game,'left'));assert(!turnSnake(game,'down'));
    stepSnake(game);assert.equal(game.direction,'up');stepSnake(game);assert.equal(game.direction,'left');
    const tail={size:4,body:[{x:1,y:1},{x:1,y:2},{x:0,y:2},{x:0,y:1}],direction:'left',queue:[],food:{x:3,y:3},score:0,state:'playing'};
    stepSnake(tail);assert.equal(tail.state,'playing');assert.deepEqual(tail.body[0],{x:0,y:1});stepSnake(tail);assert.equal(tail.state,'over');
    const self={...createSnake(),body:[{x:1,y:1},{x:2,y:1},{x:2,y:2},{x:1,y:2}],direction:'right'};stepSnake(self);assert.equal(self.state,'over');
    const full={size:2,body:[{x:0,y:0},{x:0,y:1},{x:1,y:1}],direction:'right',queue:[],food:{x:1,y:0},score:0,state:'playing'};
    stepSnake(full);assert.equal(full.state,'won');assert.equal(full.food,null);assert.equal(full.score,10);assert.equal(placeFood(full.body,2),null);
});
