// publish.js — export as standalone HTML

const Publisher = (() => {

  async function publish() {
    Editor.saveCurrentCode();
    const projectJson = Project.serialize();

    // Encode assets as base64
    const all = [Engine.state.stage, ...Engine.getAllSprites()];
    const assetMap = {};

    for (const sprite of all) {
      for (const costume of sprite.costumes) {
        if (costume.url && !assetMap[costume.url]) {
          try {
            const b64 = await urlToBase64(costume.url);
            if (b64) assetMap[costume.url] = b64;
          } catch (e) {}
        }
      }
    }

    const html = buildStandaloneHtml(projectJson, assetMap);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pyscratch-project.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function urlToBase64(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  function buildStandaloneHtml(projectJson, assetMap) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>PyScratch Project</title>
<style>
  body { margin: 0; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; color: white; }
  canvas { display: block; max-width: 100vw; max-height: 80vh; }
  #controls { margin-top: 12px; display: flex; gap: 12px; }
  button { padding: 8px 20px; border-radius: 6px; border: none; cursor: pointer; font-weight: bold; font-size: 14px; }
  #btn-start { background: #4ade80; color: #000; }
  #btn-stop { background: #f87171; color: #fff; }
  #var-display { position: fixed; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
  .var-mon { background: rgba(255,255,255,0.85); border-radius: 4px; padding: 3px 8px; font-size: 12px; color: #222; }
</style>
</head>
<body>
<canvas id="stage-canvas"></canvas>
<div id="var-display"></div>
<div id="controls">
  <button id="btn-start">▶ Start</button>
  <button id="btn-stop">■ Stop</button>
</div>
<script src="https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js"></script>
<script>
const PROJECT = ${projectJson};
const ASSETS = ${JSON.stringify(assetMap)};
// Minimal player runtime — loads project and runs it
// (This embedded player uses the same engine logic as the editor)
const STAGE_W = 480, STAGE_H = 360;
const canvas = document.getElementById('stage-canvas');
const ctx = canvas.getContext('2d');
canvas.width = STAGE_W; canvas.height = STAGE_H;
const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight * 0.8 / STAGE_H);
canvas.style.width = (STAGE_W * scale) + 'px';
canvas.style.height = (STAGE_H * scale) + 'px';

const sprites = [];
let stage = null;
let globals = PROJECT.globals || {};
let running = false;
let monitors = {};

async function loadImg(url) {
  const src = ASSETS[url] || url;
  return new Promise(res => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

async function loadSpriteImg(sp) {
  const c = sp.costumes[sp.currentCostume];
  if (c && c.url) { sp._img = await loadImg(c.url); }
  else { sp._img = null; sp._emoji = (c && c.emoji) || '🐱'; }
}

async function init() {
  stage = { ...PROJECT.stage, id: 'stage', name: 'Stage', isStage: true, visible: true, _img: null };
  await loadSpriteImg(stage);

  for (const sd of PROJECT.sprites || []) {
    const sp = { ...sd, _img: null };
    await loadSpriteImg(sp);
    sprites.push(sp);
  }

  render();
}

function render() {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  if (stage._img) ctx.drawImage(stage._img, 0, 0, STAGE_W, STAGE_H);
  else { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, STAGE_W, STAGE_H); }

  for (const sp of [...sprites].sort((a,b)=>a.layer-b.layer)) {
    if (!sp.visible) continue;
    const img = sp._img;
    const sx = sp.x + STAGE_W/2, sy = STAGE_H/2 - sp.y;
    const s = sp.size/100;
    ctx.save();
    ctx.translate(sx, sy);
    if (sp.rotationMode !== 'none') ctx.rotate((sp.direction - 90) * Math.PI / 180);
    if (img) { const w=img.width*s,h=img.height*s; ctx.drawImage(img,-w/2,-h/2,w,h); }
    else { ctx.font = (40*s)+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(sp._emoji||'❓',0,0); }
    ctx.restore();
  }
}

const keys = new Set();
document.addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
document.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

let mouseX=0, mouseY=0;
canvas.addEventListener('mousemove', e => {
  const r=canvas.getBoundingClientRect();
  mouseX=(e.clientX-r.left)/scale - STAGE_W/2;
  mouseY=-((e.clientY-r.top)/scale - STAGE_H/2);
});

function makeSuspend(secs) {
  const s=new Sk.misceval.Suspension();
  s.resume=()=>Sk.builtin.none.none$;
  s.data={type:'Sk.promise',promise:new Promise(r=>setTimeout(r,secs*1000))};
  return s;
}

function buildAPI(sp) {
  const n=v=>new Sk.builtin.float_(+v);
  const none=Sk.builtin.none.none$;
  const pyBool=v=>v?Sk.builtin.bool.true$:Sk.builtin.bool.false$;
  const f=fn=>new Sk.builtin.func(fn);
  return {
    move_steps: f(steps=>{const r=(sp.direction-90)*Math.PI/180;sp.x+=Math.cos(r)*+steps;sp.y-=-Math.sin(r)*+steps;return none;}),
    turn: f(d=>{sp.direction=(sp.direction+(+d)+360)%360;return none;}),
    go_to: f((x,y)=>{ if(y===undefined){const t=Sk.ffi.remapToJs(x);if(t==='random'){sp.x=Math.random()*480-240;sp.y=Math.random()*360-180;}else if(t==='mouse'){sp.x=mouseX;sp.y=mouseY;}}else{sp.x=+Sk.ffi.remapToJs(x);sp.y=+Sk.ffi.remapToJs(y);}return none;}),
    change_x: f(v=>{sp.x+=+Sk.ffi.remapToJs(v);return none;}),
    change_y: f(v=>{sp.y+=+Sk.ffi.remapToJs(v);return none;}),
    set_x: f(v=>{sp.x=+Sk.ffi.remapToJs(v);return none;}),
    set_y: f(v=>{sp.y=+Sk.ffi.remapToJs(v);return none;}),
    get_x: f(()=>n(sp.x)),
    get_y: f(()=>n(sp.y)),
    get_direction: f(()=>n(sp.direction)),
    on_edge: f(()=>pyBool(Math.abs(sp.x)>230||Math.abs(sp.y)>170)),
    bounce: f(()=>{
      const r=(sp.direction-90)*Math.PI/180;
      let dx=Math.cos(r),dy=-Math.sin(r);
      if(Math.abs(sp.x)>230)dx=-dx;
      if(Math.abs(sp.y)>170)dy=-dy;
      sp.direction=(Math.atan2(-dy,dx)*180/Math.PI+90+360)%360;
      return none;
    }),
    set_size: f(v=>{sp.size=+Sk.ffi.remapToJs(v);return none;}),
    change_size: f(v=>{sp.size+=+Sk.ffi.remapToJs(v);return none;}),
    show: f(()=>{sp.visible=true;return none;}),
    hide: f(()=>{sp.visible=false;return none;}),
    say: f((msg,secs)=>{sp._say=Sk.ffi.remapToJs(msg);if(secs)return makeSuspend(+Sk.ffi.remapToJs(secs));return none;}),
    wait: f(s=>makeSuspend(+Sk.ffi.remapToJs(s))),
    stop: f(()=>{running=false;return none;}),
    stop_this_thread: f(()=>{throw new Sk.builtin.SystemExit('stop');}),
    key_pressed: f(k=>pyBool(keys.has(Sk.ffi.remapToJs(k).toLowerCase()))),
    mouse_x: f(()=>n(mouseX)),
    mouse_y: f(()=>n(mouseY)),
    touching: f(t=>{
      const tn=Sk.ffi.remapToJs(t);
      if(tn==='edge')return pyBool(Math.abs(sp.x)>230||Math.abs(sp.y)>170);
      const o=sprites.find(s=>s.name===tn||s.id===tn);
      if(!o)return pyBool(false);
      const aw=(sp._img?sp._img.width:40)*(sp.size/100)/2;
      const ah=(sp._img?sp._img.height:40)*(sp.size/100)/2;
      const bw=(o._img?o._img.width:40)*(o.size/100)/2;
      const bh=(o._img?o._img.height:40)*(o.size/100)/2;
      return pyBool(!(sp.x+aw<o.x-bw||sp.x-aw>o.x+bw||sp.y+ah<o.y-bh||sp.y-ah>o.y+bh));
    }),
    set_var: f((name,val)=>{globals[Sk.ffi.remapToJs(name)]=Sk.ffi.remapToJs(val);updateMonitors();return none;}),
    get_var: f(name=>{const v=globals[Sk.ffi.remapToJs(name)]??0;return typeof v==='number'?n(v):new Sk.builtin.str(''+v);}),
    display_variable: f((name,vis)=>{monitors[Sk.ffi.remapToJs(name)]={visible:!!Sk.ffi.remapToJs(vis)};updateMonitors();return none;}),
    random: f((a,b)=>n(Math.random()*(+Sk.ffi.remapToJs(b)-+Sk.ffi.remapToJs(a))+Sk.ffi.remapToJs(a))),
    random_int: f((a,b)=>new Sk.builtin.int_(Math.floor(Math.random()*(+Sk.ffi.remapToJs(b)-+Sk.ffi.remapToJs(a)+1))+Sk.ffi.remapToJs(a))),
    broadcast: f(evt=>{return none;}),
    next_costume: f(()=>{if(sp.costumes.length>1){sp.currentCostume=(sp.currentCostume+1)%sp.costumes.length;loadSpriteImg(sp).then(render);}return none;}),
    set_costume: f(name=>{const n=Sk.ffi.remapToJs(name);const i=sp.costumes.findIndex(c=>c.name===n);if(i>=0){sp.currentCostume=i;loadSpriteImg(sp).then(render);}return none;}),
  };
}

function updateMonitors() {
  const d=document.getElementById('var-display');
  d.innerHTML=Object.entries(monitors).filter(([,m])=>m.visible).map(([k])=>\`<div class="var-mon"><b>\${k}</b>: \${globals[k]??0}</div>\`).join('');
}

async function runSprite(sp) {
  const api=buildAPI(sp);
  Sk.configure({output:()=>{},read:x=>{if(Sk.builtinFiles?.files[x])return Sk.builtinFiles.files[x];throw"File not found: '"+x+"'"}, __future__:Sk.python3});
  for(const[k,v]of Object.entries(api))Sk.builtins[k]=v;
  for(const thread of sp.threads||[]) {
    if(!thread.code||!thread.code.trim())continue;
    if(!/def\\s+game_start/.test(thread.code))continue;
    const code=thread.code+'\\ngame_start()';
    (async()=>{
      try{ await Sk.misceval.asyncToPromise(()=>Sk.importMainWithBody('<main>',false,code,true)); }
      catch(e){ if(String(e).includes('stop'))return; console.warn('Thread error',e); }
    })();
  }
}

function gameLoop() {
  if(!running){render();return;}
  render();
  requestAnimationFrame(gameLoop);
}

document.getElementById('btn-start').addEventListener('click', async()=>{
  if(running)return;
  running=true;
  for(const sp of sprites) await runSprite(sp);
  await runSprite(stage);
  gameLoop();
});

document.getElementById('btn-stop').addEventListener('click',()=>{ running=false; render(); });

init();
</script>
</body>
</html>`;
  }

  return { publish };
})();
