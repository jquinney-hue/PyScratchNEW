'use strict';

// ─── Constants ───
const STAGE_WIDTH  = 480;
const STAGE_HEIGHT = 360;

const URLS = {
  SPRITE_LIB: 'https://raw.githubusercontent.com/jquinney-hue/pyscratchurls.github.io/refs/heads/main/costumeurls.txt',
  STAGE_LIB:  'https://raw.githubusercontent.com/jquinney-hue/pyscratchurls.github.io/refs/heads/main/backdropurls.txt',
  DEFAULT_SPRITE: 'https://cdn.assets.scratch.mit.edu/internalapi/asset/bcf454acf82e4504149f7ffe07081dbc.svg/get/',
  DEFAULT_STAGE:  'https://cdn.assets.scratch.mit.edu/internalapi/asset/8eb8790be5507fdccf73e7c1570bbbab.svg/get/'
};

// ─── Collision Canvas (off-screen, willReadFrequently) ───
const collisionCanvas = document.createElement('canvas');
collisionCanvas.width  = STAGE_WIDTH;
collisionCanvas.height = STAGE_HEIGHT;
const collisionCtx = collisionCanvas.getContext('2d', { willReadFrequently: true });

// ─── Global State ───
let sprites           = [];
let stage             = null;
let currentSelection  = null;
let isRunning         = false;
let pressedKeys       = {};
let mouse             = { x: 0, y: 0, down: false };
let displayedVars     = {};
let libraryCallback   = null;
let activeEditorSprId = null; // which sprite the editor is showing

// ─── Skull runtime handles ───
let skulptRunners = []; // list of { sprite, cancel } so we can stop them

// ─── FPS tracking ───
let fpsFrames = 0, fpsLast = performance.now();

// ─────────────────────────────────────────────────────────────────
//  SPRITE CLASS
// ─────────────────────────────────────────────────────────────────
class Sprite {
  constructor(name, isStage = false) {
    this.id          = isStage ? 'stage' : 's_' + Date.now() + Math.random().toString(36).slice(2);
    this.name        = name;
    this.isStage     = isStage;
    this.x           = 0;
    this.y           = 0;
    this.direction   = 90;
    this.size        = 100;
    this.visible     = true;
    this.rotationStyle = 'all';
    this.costumes    = isStage
      ? [{ name: 'Backdrop1', url: URLS.DEFAULT_STAGE }]
      : [{ name: 'Costume1',  url: URLS.DEFAULT_SPRITE }];
    this.currentCostumeIdx = 0;
    this.code        = isStage ? '# Stage code\n' : 'from pyscratch import *\n\ndef game_start():\n    pass\n';
    this.speechBubble = { text: null };
    this.imgCache    = {};
    this._listeners  = { onClick: [], onKey: [], onMessage: [] };
    this._hitEdges   = {};
    this._askResolve = null;
  }
  get currentCostume() { return this.costumes[this.currentCostumeIdx]; }
  async loadImage(url) {
    if (this.imgCache[url]) return this.imgCache[url];
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload  = () => { this.imgCache[url] = img; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
}

// ─────────────────────────────────────────────────────────────────
//  CANVAS & RENDER LOOP
// ─────────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function drawSprite(s, targetCtx, isStageSprite = false) {
  const costume = s.currentCostume;
  if (!costume) return;
  const img = s.imgCache[costume.url];
  if (!img) { s.loadImage(costume.url); return; }

  targetCtx.save();
  targetCtx.translate(STAGE_WIDTH / 2 + s.x, STAGE_HEIGHT / 2 - s.y);

  if (!isStageSprite) {
    let rot = (s.direction - 90) * Math.PI / 180;
    let sx  = s.size / 100, sy = s.size / 100;
    if (s.rotationStyle === 'none') {
      rot = 0;
    } else if (s.rotationStyle === 'left-right') {
      rot = 0;
      let d = ((s.direction % 360) + 360) % 360;
      if (d > 180) sx = -sx;
    }
    targetCtx.rotate(rot);
    targetCtx.scale(sx, sy);
    targetCtx.drawImage(img, -img.width / 2, -img.height / 2);
  } else {
    targetCtx.scale(STAGE_WIDTH / img.width, STAGE_HEIGHT / img.height);
    targetCtx.drawImage(img, -img.width / 2, -img.height / 2);
  }
  targetCtx.restore();

  if (targetCtx === ctx && s.speechBubble.text) {
    drawBubble(s.x, s.y, String(s.speechBubble.text));
  }
}

function drawBubble(x, y, text) {
  const cx = STAGE_WIDTH / 2 + x + 20;
  const cy = STAGE_HEIGHT / 2 - y - 44;
  ctx.font = '12px sans-serif';
  const tw = ctx.measureText(text).width + 14;
  const th = 26;
  ctx.fillStyle   = 'white';
  ctx.strokeStyle = '#333';
  ctx.lineWidth   = 1.2;
  ctx.beginPath(); ctx.roundRect(cx, cy, tw, th, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.fillText(text, cx + 7, cy + 17);
}

function renderLoop() {
  ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  if (stage && stage.visible) drawSprite(stage, ctx, true);
  for (const s of sprites) if (s.visible) drawSprite(s, ctx);

  // FPS
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 1000) {
    document.getElementById('fps-counter').textContent = fpsFrames;
    fpsFrames = 0; fpsLast = now;
  }
  requestAnimationFrame(renderLoop);
}

// ─────────────────────────────────────────────────────────────────
//  PIXEL-PERFECT HELPERS
// ─────────────────────────────────────────────────────────────────
function spriteAt(s, mx, my) {
  if (!s.visible) return false;
  const img = s.currentCostume ? s.imgCache[s.currentCostume.url] : null;
  if (!img) return false;
  const diag   = Math.hypot(img.width, img.height) / 2;
  const radius = diag * (s.size / 100);
  if (Math.hypot(mx - s.x, my - s.y) > radius + 4) return false;
  collisionCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  drawSprite(s, collisionCtx);
  const px = Math.floor(STAGE_WIDTH / 2 + mx);
  const py = Math.floor(STAGE_HEIGHT / 2 - my);
  if (px < 0 || px >= STAGE_WIDTH || py < 0 || py >= STAGE_HEIGHT) return false;
  return collisionCtx.getImageData(px, py, 1, 1).data[3] > 0;
}

function spritesOverlap(a, b) {
  const ia = a.imgCache[a.currentCostume?.url];
  const ib = b.imgCache[b.currentCostume?.url];
  if (!ia || !ib) return false;
  const ra = Math.hypot(ia.width, ia.height) / 2 * (a.size / 100);
  const rb = Math.hypot(ib.width, ib.height) / 2 * (b.size / 100);
  if (Math.hypot(a.x - b.x, a.y - b.y) > ra + rb) return false;
  collisionCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  drawSprite(a, collisionCtx);
  collisionCtx.globalCompositeOperation = 'source-in';
  drawSprite(b, collisionCtx);
  collisionCtx.globalCompositeOperation = 'source-over';
  const minX = Math.max(0, Math.floor(STAGE_WIDTH / 2 + Math.min(a.x - ra, b.x - rb)));
  const minY = Math.max(0, Math.floor(STAGE_HEIGHT / 2 - Math.max(a.y + ra, b.y + rb)));
  const maxX = Math.min(STAGE_WIDTH,  Math.ceil(STAGE_WIDTH / 2 + Math.max(a.x + ra, b.x + rb)));
  const maxY = Math.min(STAGE_HEIGHT, Math.ceil(STAGE_HEIGHT / 2 - Math.min(a.y - ra, b.y - rb)));
  const w = maxX - minX, h = maxY - minY;
  if (w <= 0 || h <= 0) return false;
  const data = collisionCtx.getImageData(minX, minY, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────
//  SKULPT PYTHON RUNNER
// ─────────────────────────────────────────────────────────────────

/*
  We define a custom Skulpt module "pyscratch" that exposes the sprite API.
  Each sprite runs its own Skulpt execution. The "current sprite" context is
  passed via a module-level variable that is set just before each execution.
*/

let _currentSpriteForSkulpt = null; // set before each sprite's run

function buildPyScratchModule(sprite) {
  // Helper: Skulpt Suspension (like an async pause for Skulpt's scheduler)
  function makeSuspension(resumeWith) {
    const susp = new Sk.misceval.Suspension();
    susp.resume = () => resumeWith;
    susp.data = { type: 'Sk.promise', promise: resumeWith };
    return susp;
  }

  function pyFloat(v) { return new Sk.builtin.float_(v); }
  function pyBool(v)  { return v ? Sk.builtin.bool.true$ : Sk.builtin.bool.false$; }
  function pyStr(v)   { return new Sk.builtin.str(String(v)); }
  function pyNone()   { return Sk.builtin.none.none$; }
  function jsNum(pyV) { return Sk.ffi.remapToJs(pyV); }
  function jsStr(pyV) { return Sk.ffi.remapToJs(pyV); }

  const mod = {};

  // ── Motion ──
  mod.move_steps = new Sk.builtin.func(function(steps) {
    const n = jsNum(steps);
    const rad = (90 - sprite.direction) * Math.PI / 180;
    sprite.x += n * Math.cos(rad);
    sprite.y += n * Math.sin(rad);
    return pyNone();
  });

  mod.turn = new Sk.builtin.func(function(deg) {
    sprite.direction += jsNum(deg);
    return pyNone();
  });

  mod.go_to = new Sk.builtin.func(function(x, y) {
    if (Sk.ffi.remapToJs(x) === 'random') {
      sprite.x = Math.random() * STAGE_WIDTH  - STAGE_WIDTH  / 2;
      sprite.y = Math.random() * STAGE_HEIGHT - STAGE_HEIGHT / 2;
    } else {
      sprite.x = jsNum(x);
      sprite.y = jsNum(y);
    }
    return pyNone();
  });

  mod.set_x = new Sk.builtin.func(function(v) { sprite.x = jsNum(v); return pyNone(); });
  mod.set_y = new Sk.builtin.func(function(v) { sprite.y = jsNum(v); return pyNone(); });
  mod.change_x = new Sk.builtin.func(function(v) { sprite.x += jsNum(v); return pyNone(); });
  mod.change_y = new Sk.builtin.func(function(v) { sprite.y += jsNum(v); return pyNone(); });
  mod.get_x = new Sk.builtin.func(function() { return pyFloat(sprite.x); });
  mod.get_y = new Sk.builtin.func(function() { return pyFloat(sprite.y); });
  mod.get_direction = new Sk.builtin.func(function() { return pyFloat(sprite.direction); });

  mod.point_towards = new Sk.builtin.func(function(a, b) {
    const av = Sk.ffi.remapToJs(a);
    if (b === undefined || b === Sk.builtin.none.none$) {
      if (typeof av === 'number') { sprite.direction = av; return pyNone(); }
      if (av === 'mouse pointer' || av === 'mouse_pointer') {
        const dx = mouse.x - sprite.x, dy = mouse.y - sprite.y;
        sprite.direction = 90 - Math.atan2(dy, dx) * 180 / Math.PI;
        return pyNone();
      }
      const t = sprites.find(s => s.name === av);
      if (t) { const dx = t.x - sprite.x, dy = t.y - sprite.y; sprite.direction = 90 - Math.atan2(dy, dx) * 180 / Math.PI; }
      return pyNone();
    }
    const tx = av, ty = jsNum(b);
    sprite.direction = 90 - Math.atan2(ty - sprite.y, tx - sprite.x) * 180 / Math.PI;
    return pyNone();
  });

  mod.on_edge = new Sk.builtin.func(function() {
    sprite._hitEdges = {};
    const img = sprite.imgCache[sprite.currentCostume?.url];
    if (!img) return pyBool(false);
    const diag   = Math.hypot(img.width, img.height) / 2;
    const radius = diag * (sprite.size / 100);
    const hw = STAGE_WIDTH / 2, hh = STAGE_HEIGHT / 2;
    if (sprite.x > -hw + radius && sprite.x < hw - radius &&
        sprite.y > -hh + radius && sprite.y < hh - radius) return pyBool(false);
    collisionCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    drawSprite(sprite, collisionCtx);
    const check = (x, y, w, h) => {
      const d = collisionCtx.getImageData(x, y, w, h).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    };
    let hit = false;
    if (check(0, 0, STAGE_WIDTH, 1))            { sprite._hitEdges.top    = true; hit = true; }
    if (check(0, STAGE_HEIGHT-1, STAGE_WIDTH,1)) { sprite._hitEdges.bottom = true; hit = true; }
    if (check(0, 0, 1, STAGE_HEIGHT))            { sprite._hitEdges.left   = true; hit = true; }
    if (check(STAGE_WIDTH-1, 0, 1, STAGE_HEIGHT)){ sprite._hitEdges.right  = true; hit = true; }
    if (!hit) {
      if (sprite.x < -hw) { sprite._hitEdges.left   = true; hit = true; }
      if (sprite.x >  hw) { sprite._hitEdges.right  = true; hit = true; }
      if (sprite.y < -hh) { sprite._hitEdges.bottom = true; hit = true; }
      if (sprite.y >  hh) { sprite._hitEdges.top    = true; hit = true; }
    }
    return pyBool(hit);
  });

  mod.bounce = new Sk.builtin.func(function() {
    const edges = sprite._hitEdges || {};
    const rad = sprite.direction * Math.PI / 180;
    const vx = Math.sin(rad), vy = Math.cos(rad);
    if ((edges.left && vx < 0) || (edges.right && vx > 0))   sprite.direction = -sprite.direction;
    if ((edges.top  && vy > 0) || (edges.bottom && vy < 0)) sprite.direction = 180 - sprite.direction;
    return pyNone();
  });

  // ── Looks ──
  mod.say = new Sk.builtin.func(function(msg, secs) {
    sprite.speechBubble.text = Sk.ffi.remapToJs(msg);
    const ms = (secs !== undefined ? jsNum(secs) : 2) * 1000;
    return makeSuspension(new Promise(r => setTimeout(() => {
      sprite.speechBubble.text = null;
      r(pyNone());
    }, ms)));
  });

  mod.set_costume = new Sk.builtin.func(function(name) {
    const n  = jsStr(name);
    const idx = sprite.costumes.findIndex(c => c.name === n);
    if (idx >= 0) { sprite.currentCostumeIdx = idx; updateSpriteThumbnail(sprite); }
    return pyNone();
  });
  mod.next_costume = new Sk.builtin.func(function() {
    sprite.currentCostumeIdx = (sprite.currentCostumeIdx + 1) % sprite.costumes.length;
    updateSpriteThumbnail(sprite);
    return pyNone();
  });
  mod.set_stage = new Sk.builtin.func(function(name) {
    const n = jsStr(name), idx = stage.costumes.findIndex(c => c.name === n);
    if (idx >= 0) stage.currentCostumeIdx = idx;
    return pyNone();
  });
  mod.next_stage = new Sk.builtin.func(function() {
    stage.currentCostumeIdx = (stage.currentCostumeIdx + 1) % stage.costumes.length;
    return pyNone();
  });
  mod.set_size = new Sk.builtin.func(function(v) { sprite.size = jsNum(v); return pyNone(); });
  mod.change_size = new Sk.builtin.func(function(v) { sprite.size += jsNum(v); return pyNone(); });
  mod.show = new Sk.builtin.func(function() { sprite.visible = true;  return pyNone(); });
  mod.hide = new Sk.builtin.func(function() { sprite.visible = false; return pyNone(); });

  // ── Glide ──
  mod.glide_to = new Sk.builtin.func(function(x, y, secs) {
    let tx = Sk.ffi.remapToJs(x), ty, dur;
    if (tx === 'random') {
      tx  = Math.random() * STAGE_WIDTH  - STAGE_WIDTH  / 2;
      ty  = Math.random() * STAGE_HEIGHT - STAGE_HEIGHT / 2;
      dur = jsNum(y);
    } else {
      tx  = jsNum(x); ty = jsNum(y); dur = jsNum(secs);
    }
    const sx = sprite.x, sy = sprite.y, start = Date.now(), ms = dur * 1000;
    return makeSuspension(new Promise(r => {
      const step = () => {
        if (!isRunning) return r(pyNone());
        const p = Math.min(1, (Date.now() - start) / ms);
        sprite.x = sx + (tx - sx) * p;
        sprite.y = sy + (ty - sy) * p;
        if (p < 1) requestAnimationFrame(step); else r(pyNone());
      };
      requestAnimationFrame(step);
    }));
  });

  // ── Control ──
  mod.wait = new Sk.builtin.func(function(secs) {
    const ms = jsNum(secs) * 1000;
    return makeSuspension(new Promise(r => setTimeout(() => r(pyNone()), ms)));
  });

  mod.stop = new Sk.builtin.func(function() { stopAll(); return pyNone(); });

  mod.broadcast = new Sk.builtin.func(function(msg) {
    const m = jsStr(msg);
    for (const s of [stage, ...sprites]) {
      if (s._listeners.onMessage) s._listeners.onMessage.forEach(fn => fn(m));
    }
    return pyNone();
  });

  // ── Sensing ──
  mod.touching = new Sk.builtin.func(function(target) {
    const t = jsStr(target);
    if (t === 'mouse_pointer' || t === 'mouse pointer') {
      return pyBool(spriteAt(sprite, mouse.x, mouse.y));
    }
    const tSpr = sprites.find(s => s.name === t);
    if (!tSpr) return pyBool(false);
    return pyBool(spritesOverlap(sprite, tSpr));
  });

  mod.distance_to = new Sk.builtin.func(function(target) {
    const t = jsStr(target);
    let tx, ty;
    if (t === 'mouse_pointer' || t === 'mouse pointer') { tx = mouse.x; ty = mouse.y; }
    else { const s = sprites.find(s => s.name === t); if (!s) return pyFloat(9999); tx = s.x; ty = s.y; }
    return pyFloat(Math.hypot(sprite.x - tx, sprite.y - ty));
  });

  mod.key_pressed = new Sk.builtin.func(function(key) {
    return pyBool(!!pressedKeys[jsStr(key)]);
  });

  mod.ask = new Sk.builtin.func(function(question) {
    const overlay = document.getElementById('ask-overlay');
    const prompt  = document.getElementById('ask-prompt');
    const input   = document.getElementById('ask-input');
    const btn     = document.getElementById('ask-submit');
    prompt.textContent = sprite.name + ' asks: ' + jsStr(question);
    overlay.classList.remove('hidden');
    input.value = '';
    input.focus();
    return makeSuspension(new Promise(resolve => {
      const submit = () => {
        overlay.classList.add('hidden');
        resolve(new Sk.builtin.str(input.value));
        btn.removeEventListener('click', submit);
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', function kd(e) {
        if (e.key === 'Enter') { submit(); input.removeEventListener('keydown', kd); }
      });
    }));
  });

  // ── Variables ──
  mod.display_variable = new Sk.builtin.func(function(name, val) {
    const n = jsStr(name);
    const v = Sk.ffi.remapToJs(val);
    displayedVars[n] = v;
    updateVarDisplay();
    return pyNone();
  });
  mod.hide_variable = new Sk.builtin.func(function(name) {
    delete displayedVars[jsStr(name)];
    updateVarDisplay();
    return pyNone();
  });

  return mod;
}

// ─────────────────────────────────────────────────────────────────
//  RUN A SPRITE'S CODE THROUGH SKULPT
// ─────────────────────────────────────────────────────────────────

// Skulpt's real JS-module API: when it imports 'pyscratch', it calls
// read('pyscratch.js'), evaluates the returned string, and expects it
// to define a global $builtinmodule function that returns the module dict.
// We stash the current sprite's API on a well-known global so the
// evaluated string can close over it.
let _pyscratchCurrentSprite = null;

function read(fname) {
  if (fname === 'pyscratch.js' || fname === 'src/lib/pyscratch.js') {
    // This JS source is eval'd by Skulpt. It must define $builtinmodule.
    // We reach back to the JS variable set just before Sk.configure().
    return `
var $builtinmodule = function(name) {
  var d = Sk.__pyscratch_api__;
  d['__name__'] = new Sk.builtin.str('pyscratch');
  d['__all__'] = new Sk.builtin.list(
    Object.keys(d).filter(function(k){ return k.indexOf('__') !== 0; })
      .map(function(k){ return new Sk.builtin.str(k); })
  );
  return d;
};
`;
  }
  if (Sk.builtinFiles && Sk.builtinFiles.files && Sk.builtinFiles.files[fname]) {
    return Sk.builtinFiles.files[fname];
  }
  throw new Error('File not found: ' + fname);
}

function runSpriteCode(sprite) {
  if (!sprite.code || !sprite.code.trim()) return;

  sprite._listeners = { onClick: [], onKey: [], onMessage: [] };
  let cancelled = false;

  // Stash the API dict where the $builtinmodule closure can find it
  Sk.__pyscratch_api__ = buildPyScratchModule(sprite);

  Sk.configure({
    output:        (text) => { consoleLog(text, 'ok'); },
    read:          read,
    __future__:    Sk.python3,
    execLimit:     undefined,
    killableWhile: true,
    killableFor:   true,
    yieldLimit: 100, 
    onYield: function() {
      if (!isRunning) throw "Interrupted"; // This kills the Python script immediately
    },
  });

  // Auto-prepend import — strip any existing one first to avoid double-import
  const userCode = sprite.code.replace(/^\s*from\s+pyscratch\s+import\s+\*\s*\n?/gm, '');
  const codeToRun = 'from pyscratch import *\n' + userCode;

  // ── Frame-pacing suspension handlers ──────────────────────────
  // asyncToPromise accepts a suspHandlers map. Sk.delay and Sk.yield are
  // what killableWhile/killableFor inject on every loop iteration.
  // By default Skulpt resumes them via setImmediate (immediately).
  // We override them to wait for the next animation frame instead,
  // which caps any while/for loop to 60fps and checks isRunning for stop.
  const frameSuspHandlers = {
    'Sk.delay': (susp) => new Promise((resolve, reject) => {
      requestAnimationFrame(() => {
        if (!isRunning) { reject('__pyscratch_stopped__'); return; }
        try { resolve(susp.resume()); } catch(e) { reject(e); }
      });
    }),
    'Sk.yield': (susp) => new Promise((resolve, reject) => {
      requestAnimationFrame(() => {
        if (!isRunning) { reject('__pyscratch_stopped__'); return; }
        try { resolve(susp.resume()); } catch(e) { reject(e); }
      });
    }),
  };

  const prog = Sk.misceval.asyncToPromise(() =>
    Sk.importMainWithBody('<stdin>', false, codeToRun, true),
    frameSuspHandlers
  );

  const stopSilent = e => e === '__pyscratch_stopped__';

  prog.then((mod) => {
    if (cancelled) return;
    const d = mod.$d;

    if (d.game_start) {
      sprite._listeners._game_start = d.game_start;
      if (isRunning) {
        Sk.misceval.asyncToPromise(() =>
          Sk.misceval.callsimOrSuspendArray(d.game_start, []),
          frameSuspHandlers
        ).catch(e => {
          if (stopSilent(e) || cancelled) return;
          consoleLog('Runtime error in ' + sprite.name + ': ' + e.toString(), 'err');
        });
      }
    }
    if (d.on_click) {
      sprite._listeners.onClick.push(() => {
        if (!isRunning) return;
        Sk.misceval.asyncToPromise(() =>
          Sk.misceval.callsimOrSuspendArray(d.on_click, []),
          frameSuspHandlers
        ).catch(e => { if (!stopSilent(e)) consoleLog('on_click error: ' + e, 'err'); });
      });
    }
    if (d.on_keypress) {
      sprite._listeners.onKey.push((key) => {
        if (!isRunning) return;
        Sk.misceval.asyncToPromise(() =>
          Sk.misceval.callsimOrSuspendArray(d.on_keypress, [new Sk.builtin.str(key)]),
          frameSuspHandlers
        ).catch(e => { if (!stopSilent(e)) consoleLog('on_keypress error: ' + e, 'err'); });
      });
    }
    if (d.broadcast_receive) {
      sprite._listeners.onMessage.push((msg) => {
        if (!isRunning) return;
        Sk.misceval.asyncToPromise(() =>
          Sk.misceval.callsimOrSuspendArray(d.broadcast_receive, [new Sk.builtin.str(msg)]),
          frameSuspHandlers
        ).catch(e => { if (!stopSilent(e)) consoleLog('broadcast error: ' + e, 'err'); });
      });
    }
    consoleLog('✓ ' + sprite.name + ' loaded', 'info');
  }).catch(e => {
    if (cancelled || stopSilent(e)) return;
    consoleLog('Error in ' + sprite.name + ': ' + e.toString(), 'err');
    document.getElementById('run-status').textContent = 'Error';
    document.getElementById('run-status').style.color = 'var(--c-red)';
  });

  return { cancel: () => { cancelled = true; } };
}

// ─────────────────────────────────────────────────────────────────
//  AUTOCOMPLETE DATA
// ─────────────────────────────────────────────────────────────────
const API_KEYWORDS = [
  { word:"move_steps",   insert:"move_steps()",   sig:"move_steps(steps)",       type:"mov" },
  { word:"turn",         insert:"turn()",          sig:"turn(degrees)",            type:"mov" },
  { word:"go_to",        insert:"go_to()",         sig:"go_to(x, y)",             type:"mov" },
  { word:"glide_to",     insert:"glide_to()",      sig:"glide_to(x, y, secs)",    type:"mov" },
  { word:"point_towards",insert:"point_towards()", sig:"point_towards(x, y)",     type:"mov" },
  { word:"change_x",     insert:"change_x()",      sig:"change_x(dx)",            type:"mov" },
  { word:"change_y",     insert:"change_y()",      sig:"change_y(dy)",            type:"mov" },
  { word:"set_x",        insert:"set_x()",         sig:"set_x(x)",                type:"mov" },
  { word:"set_y",        insert:"set_y()",         sig:"set_y(y)",                type:"mov" },
  { word:"get_x",        insert:"get_x()",         sig:"get_x() → float",         type:"mov" },
  { word:"get_y",        insert:"get_y()",         sig:"get_y() → float",         type:"mov" },
  { word:"get_direction",insert:"get_direction()", sig:"get_direction() → float", type:"mov" },
  { word:"on_edge",      insert:"on_edge()",       sig:"on_edge() → bool",        type:"mov" },
  { word:"bounce",       insert:"bounce()",        sig:"bounce()",                type:"mov" },

  { word:"say",          insert:"say()",           sig:"say(msg, secs=2)",        type:"look" },
  { word:"set_costume",  insert:"set_costume()",   sig:"set_costume(name)",       type:"look" },
  { word:"next_costume", insert:"next_costume()",  sig:"next_costume()",          type:"look" },
  { word:"set_stage",    insert:"set_stage()",     sig:"set_stage(name)",         type:"look" },
  { word:"next_stage",   insert:"next_stage()",    sig:"next_stage()",            type:"look" },
  { word:"set_size",     insert:"set_size()",      sig:"set_size(percent)",       type:"look" },
  { word:"change_size",  insert:"change_size()",   sig:"change_size(amount)",     type:"look" },
  { word:"show",         insert:"show()",          sig:"show()",                  type:"look" },
  { word:"hide",         insert:"hide()",          sig:"hide()",                  type:"look" },

  { word:"game_start",   insert:"def game_start():\n    ", sig:"def game_start():", type:"evt" },
  { word:"on_click",     insert:"def on_click():\n    ",   sig:"def on_click():",   type:"evt" },
  { word:"on_keypress",  insert:"def on_keypress(key):\n    ", sig:"def on_keypress(key):", type:"evt" },
  { word:"broadcast",    insert:"broadcast()",     sig:"broadcast(msg)",          type:"evt" },

  { word:"wait",         insert:"wait()",          sig:"wait(secs)",              type:"ctrl" },
  { word:"stop",         insert:"stop()",          sig:"stop()",                  type:"ctrl" },

  { word:"touching",     insert:"touching()",      sig:"touching(sprite_name) → bool", type:"sens" },
  { word:"distance_to",  insert:"distance_to()",   sig:"distance_to(sprite_name) → float", type:"sens" },
  { word:"key_pressed",  insert:"key_pressed()",   sig:"key_pressed(key) → bool", type:"sens" },
  { word:"ask",          insert:"ask()",           sig:"ask(question) → str",     type:"sens" },

  { word:"display_variable", insert:"display_variable()", sig:"display_variable(name, value)", type:"var" },
  { word:"hide_variable",    insert:"hide_variable()",    sig:"hide_variable(name)",           type:"var" },
];

const SIG_DB = {
  "move_steps":   [["steps"]],
  "turn":         [["degrees"]],
  "go_to":        [["x", "y"], ['"random"']],
  "glide_to":     [["x", "y", "secs"], ['"random"', "secs"]],
  "point_towards":[["x", "y"], ["sprite_name"], ['"mouse pointer"'], ["degrees"]],
  "say":          [["msg", "secs=2"]],
  "set_costume":  [["name"]],
  "set_stage":    [["name"]],
  "set_size":     [["percent"]],
  "change_size":  [["amount"]],
  "wait":         [["secs"]],
  "touching":     [["sprite_name"], ['"mouse pointer"']],
  "distance_to":  [["sprite_name"], ['"mouse pointer"']],
  "ask":          [["question"]],
  "display_variable": [["name", "value"]],
  "hide_variable":    [["name"]],
  "set_x":        [["x"]], "set_y":  [["y"]],
  "change_x":     [["dx"]],"change_y":[["dy"]],
};

// ─────────────────────────────────────────────────────────────────
//  INPUT SETUP
// ─────────────────────────────────────────────────────────────────
function setupInputs() {
  const editor       = document.getElementById('code-editor');
  const acList       = document.getElementById('autocomplete-list');
  const caretMeasure = document.getElementById('caret-measure');

  let activeIdx = 0, filtered = [];

  const hide = () => { acList.style.display = 'none'; activeIdx = 0; filtered = []; };

  const caretPos = () => {
    const s = window.getComputedStyle(editor);
    caretMeasure.style.cssText = `font:${s.font};font-family:${s.fontFamily};font-size:${s.fontSize};line-height:${s.lineHeight};padding:${s.padding};letter-spacing:${s.letterSpacing};width:${s.width};white-space:pre-wrap;word-wrap:break-word;position:absolute;visibility:hidden;pointer-events:none;`;
    const text = editor.value.substring(0, editor.selectionStart);
    caretMeasure.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>').replace(/ /g,'&nbsp;') + '<span id="cm">|</span>';
    document.body.appendChild(caretMeasure);
    const m = document.getElementById('cm');
    const pos = { top: m.offsetTop, left: m.offsetLeft };
    caretMeasure.remove();
    return pos;
  };

  const showAC = (list) => {
    filtered = list;
    acList.innerHTML = '';
    list.forEach((k, i) => {
      const d = document.createElement('div');
      d.className = 'sug-item' + (i === activeIdx ? ' active' : '');
      d.innerHTML = `<span class="sug-sig">${k.sig}</span><span class="sug-badge badge-${k.type}">${k.type.toUpperCase()}</span>`;
      d.onmousedown = e => { e.preventDefault(); insert(k); };
      acList.appendChild(d);
    });
    const coords  = caretPos();
    const rect    = editor.getBoundingClientRect();
    const lh      = parseInt(getComputedStyle(editor).lineHeight) || 18;
    acList.style.top  = (rect.top  + coords.top  - editor.scrollTop  + lh) + 'px';
    acList.style.left = (rect.left + coords.left - editor.scrollLeft) + 'px';
    acList.style.display = 'block';
  };

  const showSig = (fn, argIdx) => {
    const sigs = SIG_DB[fn];
    if (!sigs) { hide(); return; }
    filtered = [];
    acList.innerHTML = '';
    sigs.forEach(args => {
      const d = document.createElement('div');
      d.className = 'sug-item';
      const html = args.map((a, i) => i === argIdx
        ? `<strong style="color:var(--c-accent)">${a}</strong>`
        : `<span style="color:var(--c-muted)">${a}</span>`
      ).join(', ');
      d.innerHTML = `<span class="sug-sig" style="font-family:monospace;font-size:11px">${fn}(${html})</span>`;
      acList.appendChild(d);
    });
    const coords = caretPos();
    const rect   = editor.getBoundingClientRect();
    const lh     = parseInt(getComputedStyle(editor).lineHeight) || 18;
    acList.style.top  = (rect.top  + coords.top  - editor.scrollTop  + lh) + 'px';
    acList.style.left = (rect.left + coords.left - editor.scrollLeft) + 'px';
    acList.style.display = 'block';
  };

  const insert = (item) => {
    const val = editor.value, end = editor.selectionEnd;
    let start = end - 1;
    while (start >= 0 && /[a-zA-Z0-9_.]/.test(val[start])) start--;
    start++;
    editor.setSelectionRange(start, end);
    document.execCommand('insertText', false, item.insert);
    if (item.insert.endsWith('()')) {
      const p = start + item.insert.length - 1;
      editor.setSelectionRange(p, p);
    }
    hide();
    updateAC();
  };

  const updateAC = () => {
    const val = editor.value, cur = editor.selectionEnd;
    // Signature help
    let depth = 0, scanPos = cur - 1, argIdx = 0, foundParen = false;
    while (scanPos >= 0) {
      const c = val[scanPos];
      if (c === ')') depth++;
      else if (c === '(') { if (depth > 0) depth--; else { foundParen = true; break; } }
      else if (c === ',' && depth === 0) argIdx++;
      scanPos--;
    }
    if (foundParen) {
      let ne = scanPos, ns = ne - 1;
      while (ns >= 0 && /[a-zA-Z0-9_.]/.test(val[ns])) ns--;
      ns++;
      const fn = val.substring(ns, ne);
      if (SIG_DB[fn]) { showSig(fn, argIdx); return; }
    }
    // Autocomplete
    let ws = cur - 1;
    while (ws >= 0 && /[a-zA-Z0-9_.]/.test(val[ws])) ws--;
    const word = val.substring(ws + 1, cur);
    if (word.length > 0) {
      const matches = API_KEYWORDS.filter(k => k.word.startsWith(word.toLowerCase()));
      if (matches.length) { activeIdx = 0; showAC(matches); return; }
    }
    hide();
  };

  editor.addEventListener('input', e => {
    // Save to sprite
    const s = currentSelection === 'stage' ? stage : sprites.find(s => s.id === currentSelection);
    if (s) s.code = e.target.value;
    updateAC();
  });
  editor.addEventListener('click', updateAC);
  editor.addEventListener('keyup', e => {
    if (!['ArrowUp','ArrowDown','Enter','Tab','Escape'].includes(e.key)) updateAC();
  });

  editor.addEventListener('keydown', e => {
    // Autocomplete navigation
    if (acList.style.display === 'block' && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx+1)%filtered.length; showAC(filtered); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx-1+filtered.length)%filtered.length; showAC(filtered); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(filtered[activeIdx]); return; }
      if (e.key === 'Escape') { hide(); return; }
    }
    // Tab indent/unindent
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      if (!e.shiftKey && start === end) { document.execCommand('insertText', false, '    '); return; }
      const ls = editor.value.lastIndexOf('\n', start-1) + 1;
      let le = editor.value.indexOf('\n', end); if (le === -1) le = editor.value.length;
      const lines = editor.value.substring(ls, le).split('\n');
      const newBlock = e.shiftKey
        ? lines.map(l => l.replace(/^( {1,4}|\t)/, '')).join('\n')
        : lines.map(l => '    ' + l).join('\n');
      editor.setSelectionRange(ls, le);
      document.execCommand('insertText', false, newBlock);
      editor.setSelectionRange(ls, ls + newBlock.length);
    }
    // Enter auto-indent
    if (e.key === 'Enter') {
      e.preventDefault();
      const start = editor.selectionStart, val = editor.value;
      const ls = val.lastIndexOf('\n', start-1) + 1;
      const line = val.substring(ls, start);
      let indent = line.match(/^(\s*)/)[1];
      if (line.trimEnd().endsWith(':')) indent += '    ';
      document.execCommand('insertText', false, '\n' + indent);
    }
  });

  // Angle picker
  const ap = document.getElementById('angle-picker');
  ap.addEventListener('mousedown', e => {
    const move = ev => {
      const r = ap.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      let a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180/Math.PI + 90;
      if (a < 0) a += 360;
      a = Math.round(a / 5) * 5;
      const s = currentSelection === 'stage' ? null : sprites.find(s => s.id === currentSelection);
      if (s) { s.direction = a; updatePropBar(); }
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    move(e);
  });

  // Canvas mouse
  let dragging = null, dox = 0, doy = 0;
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    const sx = STAGE_WIDTH / r.width, sy = STAGE_HEIGHT / r.height;
    mouse.x = (e.clientX - r.left) * sx - STAGE_WIDTH/2;
    mouse.y = -((e.clientY - r.top) * sy - STAGE_HEIGHT/2);
    if (dragging) {
      dragging.x = mouse.x + dox;
      dragging.y = mouse.y + doy;
      if (currentSelection === dragging.id) updatePropBar();
    }
  });
  canvas.addEventListener('mousedown', () => {
    mouse.down = true;
    if (!document.fullscreenElement) {
      for (let i = sprites.length-1; i >= 0; i--) {
        const s = sprites[i];
        if (spriteAt(s, mouse.x, mouse.y)) {
          dragging = s; dox = s.x - mouse.x; doy = s.y - mouse.y;
          if (currentSelection !== s.id) selectSprite(s.id);
          break;
        }
      }
    }
    if (isRunning) {
      [stage, ...sprites].forEach(s => {
        if (!s.visible) return;
        let hit = s.isStage || spriteAt(s, mouse.x, mouse.y);
        if (hit) s._listeners.onClick.forEach(fn => fn());
      });
    }
  });
  canvas.addEventListener('mouseup',    () => { mouse.down = false; dragging = null; });
  canvas.addEventListener('mouseleave', () => { mouse.down = false; dragging = null; });

  const normKey = k => {
    if (k===' ') return 'space'; if (k==='ArrowUp') return 'up'; if (k==='ArrowDown') return 'down';
    if (k==='ArrowLeft') return 'left'; if (k==='ArrowRight') return 'right'; if (k==='Enter') return 'enter';
    return k.toLowerCase();
  };
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = normKey(e.key);
    if (pressedKeys[key]) return;
    pressedKeys[key] = true;
    if (isRunning) [stage, ...sprites].forEach(s => s._listeners.onKey.forEach(fn => fn(key)));
  });
  window.addEventListener('keyup', e => { pressedKeys[normKey(e.key)] = false; });
}

// ─────────────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────────────
function consoleLog(text, cls = '') {
  const out = document.getElementById('console-output');
  const div = document.createElement('div');
  div.className = 'con-line ' + cls;
  div.textContent = text;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}
function clearConsole() { document.getElementById('console-output').innerHTML = ''; }

function updateVarDisplay() {
  const ov = document.getElementById('variable-overlay');
  ov.innerHTML = '';
  for (const [k, v] of Object.entries(displayedVars)) {
    const d = document.createElement('div');
    d.className = 'var-box';
    d.innerHTML = `<span class="var-name">${k}</span><span class="var-value">${v}</span>`;
    ov.appendChild(d);
  }
}

function renderEditorTabs() {
  const tabs = document.getElementById('sprite-tabs');
  tabs.innerHTML = '';
  const all = [stage, ...sprites];
  all.forEach(s => {
    const t = document.createElement('div');
    t.className = 'sprite-tab' + (s.id === activeEditorSprId ? ' active' : '');
    t.textContent = s.name;
    t.onclick = () => { activeEditorSprId = s.id; loadEditorForSprite(s); renderEditorTabs(); };
    tabs.appendChild(t);
  });
  const add = document.createElement('div');
  add.className = 'sprite-tab add-tab';
  add.innerHTML = '<i class="fa-solid fa-plus"></i>';
  add.onclick = createNewSprite;
  tabs.appendChild(add);
}

function loadEditorForSprite(s) {
  document.getElementById('code-editor').value = s.code || '';
  document.getElementById('editor-filename').textContent = (s.isStage ? 'stage' : s.name.toLowerCase().replace(/\s+/g,'_')) + '.py';
}

function renderSpriteList() {
  const list = document.getElementById('sprite-list');
  list.innerHTML = '';
  [stage, ...sprites].forEach(s => {
    const card = document.createElement('div');
    card.className = 'spr-card' + (currentSelection === s.id ? ' selected' : '');
    if (!s.isStage) {
      const img = document.createElement('img');
      img.src = s.currentCostume?.url || '';
      img.id = 'thumb-' + s.id;
      card.appendChild(img);
    } else {
      const ico = document.createElement('i');
      ico.className = 'fa-solid fa-image';
      ico.style.fontSize = '24px'; ico.style.color = 'var(--c-muted)';
      card.appendChild(ico);
    }
    const nm = document.createElement('div');
    nm.className = 'spr-name';
    nm.textContent = s.name;
    card.appendChild(nm);
    if (!s.isStage) {
      const del = document.createElement('button');
      del.className = 'spr-del';
      del.innerHTML = '×';
      del.onclick = e => { e.stopPropagation(); deleteSprite(s.id); };
      card.appendChild(del);
    }
    card.onclick = () => selectSprite(s.id);
    list.appendChild(card);
  });
  // Add button
  const add = document.createElement('div');
  add.className = 'spr-card spr-add';
  add.innerHTML = '<i class="fa-solid fa-plus"></i>';
  add.onclick = createNewSprite;
  list.appendChild(add);
}

function renderCostumes() {
  const s = currentSelection === 'stage' ? stage : sprites.find(s => s.id === currentSelection);
  const section = document.getElementById('costumes-section');
  section.innerHTML = '';
  if (!s) return;
  s.costumes.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'cos-card' + (i === s.currentCostumeIdx ? ' selected' : '');
    card.innerHTML = `
      <img src="${c.url}">
      <span class="cos-name">${c.name}</span>
      <i class="fa-solid fa-trash cos-del" onclick="removeCostume(${i}, event)"></i>
    `;
    card.onclick = () => { s.currentCostumeIdx = i; renderCostumes(); updateSpriteThumbnail(s); };
    section.appendChild(card);
  });
}

function switchRightTab(tab) {
  document.getElementById('tab-props').classList.toggle('hidden', tab !== 'props');
  document.getElementById('tab-costumes').classList.toggle('hidden', tab !== 'costumes');
  document.getElementById('tab-props-btn').classList.toggle('active', tab === 'props');
  document.getElementById('tab-cos-btn').classList.toggle('active', tab === 'costumes');
  if (tab === 'costumes') renderCostumes();
}

function selectSprite(id) {
  currentSelection = id;
  renderSpriteList();
  updatePropBar();
  renderCostumes();
}

function getSelectedSprite() {
  if (currentSelection === 'stage') return stage;
  return sprites.find(s => s.id === currentSelection);
}

function updatePropBar() {
  const s = getSelectedSprite();
  if (!s) return;
  document.getElementById('prop-name').value = s.name;
  document.getElementById('prop-x').value    = Math.round(s.x);
  document.getElementById('prop-y').value    = Math.round(s.y);
  document.getElementById('prop-size').value = s.size;
  document.getElementById('prop-dir').value  = Math.round(s.direction);
  document.getElementById('prop-rot-style').value = s.rotationStyle;
  document.getElementById('angle-picker-line').style.transform = `rotate(${s.direction - 90}deg)`;
  document.getElementById('dir-display').textContent = Math.round(s.direction) + '°';
  const disabled = s.isStage;
  ['prop-x','prop-y','prop-size','prop-dir','prop-rot-style'].forEach(id => {
    document.getElementById(id).disabled = disabled;
  });
}

function updateSpriteProp(prop, val) {
  const s = getSelectedSprite();
  if (!s || s.isStage) return;
  if (prop === 'name')          { s.name = val; renderSpriteList(); renderEditorTabs(); }
  else if (prop === 'rotationStyle') s.rotationStyle = val;
  else s[prop] = parseFloat(val);
  if (prop === 'direction') {
    document.getElementById('angle-picker-line').style.transform = `rotate(${s.direction - 90}deg)`;
    document.getElementById('dir-display').textContent = Math.round(s.direction) + '°';
  }
}

function createNewSprite() {
  const s = new Sprite('Sprite' + (sprites.length + 1));
  sprites.push(s);
  selectSprite(s.id);
  activeEditorSprId = s.id;
  loadEditorForSprite(s);
  renderEditorTabs();
}

function deleteSprite(id) {
  showCustomConfirm('Delete this sprite?', () => {
    sprites = sprites.filter(s => s.id !== id);
    if (currentSelection === id) selectSprite('stage');
    if (activeEditorSprId === id) {
      activeEditorSprId = 'stage';
      loadEditorForSprite(stage);
    }
    renderEditorTabs();
  });
}

function updateSpriteThumbnail(s) {
  const img = document.getElementById('thumb-' + s.id);
  if (img && s.currentCostume) img.src = s.currentCostume.url;
}

// ─── Costumes ───
function openLibraryForAdd() {
  document.getElementById('library-title').textContent = 'Add Costume from Library';
  libraryCallback = (url) => {
    const s = getSelectedSprite();
    s.costumes.push({ name: 'Costume ' + (s.costumes.length + 1), url });
    renderCostumes();
  };
  populateLibraryGrid();
  document.getElementById('library-modal').classList.remove('hidden');
}

function populateLibraryGrid() {
  const grid = document.getElementById('library-grid');
  grid.innerHTML = '';
  const s    = getSelectedSprite();
  const urls = (s && s.isStage) ? window.stageLibUrls : window.spriteLibUrls;
  if (!urls) { grid.textContent = 'Loading…'; return; }
  urls.forEach(url => {
    const item = document.createElement('div');
    item.className = 'lib-item';
    const img = document.createElement('img'); img.src = url; img.loading = 'lazy';
    item.appendChild(img);
    item.onclick = () => {
      if (libraryCallback) libraryCallback(url);
      document.getElementById('library-modal').classList.add('hidden');
    };
    grid.appendChild(item);
  });
}

function removeCostume(idx, e) {
  if (e) e.stopPropagation();
  const s = getSelectedSprite();
  if (s.costumes.length <= 1) return showAlert('Must have at least one costume.');
  showCustomConfirm('Delete costume?', () => {
    s.costumes.splice(idx, 1);
    if (s.currentCostumeIdx >= s.costumes.length) s.currentCostumeIdx = s.costumes.length - 1;
    renderCostumes(); updateSpriteThumbnail(s);
  });
}

// ─── Modals ───
function showCustomPrompt(msg, def, onOk) {
  const m = document.getElementById('prompt-modal');
  document.getElementById('prompt-msg').textContent = msg;
  const inp = document.getElementById('prompt-input'); inp.value = def;
  m.classList.remove('hidden'); inp.focus(); inp.select();
  const close = () => { m.classList.add('hidden'); };
  document.getElementById('prompt-ok').onclick     = () => { if (inp.value.trim()) onOk(inp.value); close(); };
  document.getElementById('prompt-cancel').onclick = close;
  inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) { onOk(inp.value); close(); } };
}
function showCustomConfirm(msg, onYes) {
  const m = document.getElementById('confirm-modal');
  document.getElementById('confirm-msg').textContent = msg;
  m.classList.remove('hidden');
  document.getElementById('confirm-yes').onclick = () => { m.classList.add('hidden'); onYes(); };
  document.getElementById('confirm-no').onclick  = () => m.classList.add('hidden');
}
function showAlert(msg) {
  document.getElementById('alert-msg').textContent = msg;
  document.getElementById('alert-modal').classList.remove('hidden');
}
function showHelp() { document.getElementById('help-modal').classList.remove('hidden'); }

// ─── Run / Stop ───
function stopAll() {
  isRunning = false;
  window.isRunning = false;
  document.body.classList.remove('running');
  document.getElementById('run-status').textContent = 'Stopped';
  document.getElementById('run-status').style.color = 'var(--c-red)';
  // Cancel all Skulpt runners
  skulptRunners.forEach(r => r && r.cancel && r.cancel());
  skulptRunners = [];
}

function startAll() {
  stopAll();
  consoleLog('─── Starting ───', 'info');
  displayedVars = {};
  updateVarDisplay();
  pressedKeys = {};

  setTimeout(() => {
    isRunning = true;
    window.isRunning = true;
    document.body.classList.add('running');
    document.getElementById('run-status').textContent = 'Running';
    document.getElementById('run-status').style.color = 'var(--c-green)';

    // Reset listeners
    [stage, ...sprites].forEach(s => s._listeners = { onClick: [], onKey: [], onMessage: [] });

    // Run each sprite
    skulptRunners = [stage, ...sprites].map(s => runSpriteCode(s));
  }, 80);
}

// ─── Save / Load / Publish ───
function saveProject() {
  const data = {
    v: 2,
    sprites: sprites.map(s => ({ ...s, imgCache: {} })),
    stage:   { ...stage,   imgCache: {} }
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'project.ps2'; a.click();
}

function loadProject(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const data = JSON.parse(e.target.result);
    stage   = Object.assign(new Sprite('Stage', true), data.stage);
    sprites = data.sprites.map(sd => Object.assign(new Sprite(sd.name), sd));
    selectSprite(sprites[0]?.id || 'stage');
    activeEditorSprId = sprites[0]?.id || 'stage';
    loadEditorForSprite(getSelectedSprite() || stage);
    renderEditorTabs();
    renderSpriteList();
  };
  reader.readAsText(file);
}

function publishProject() {
  const exportData = {
    sprites: sprites.map(s => ({ ...s, imgCache: {} })),
    stage:   { ...stage,   imgCache: {} }
  };
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PyScratch Game</title>
<script src="https://skulpt.org/js/skulpt.min.js"><\/script>
<script src="https://skulpt.org/js/skulpt-stdlib.js"><\/script>
<style>
  body { background:#111; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  #wrap { position:relative; width:480px; height:360px; border:2px solid #333; overflow:hidden; }
  canvas { display:block; }
  #variable-overlay { pointer-events:none; position:absolute; inset:0; padding:8px; display:flex; flex-direction:column; gap:4px; align-items:flex-start; }
  .var-box { background:rgba(108,99,255,.85); color:white; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold; }
  #ask-overlay { position:absolute; bottom:10px; left:10px; right:10px; background:#1a1d2e; padding:10px; border-radius:8px; display:flex; flex-direction:column; gap:6px; border:1px solid #6c63ff; }
  #ask-overlay.hidden { display:none; }
  #ask-row { display:flex; }
  #ask-input { flex:1; background:#0d0f1a; color:#e0e0f0; border:1px solid #2a2d3e; border-right:none; border-radius:4px 0 0 4px; padding:5px 8px; font-size:12px; outline:none; }
  #ask-submit { background:#6c63ff; color:white; border:none; border-radius:0 4px 4px 0; padding:5px 12px; cursor:pointer; }
  #controls { position:absolute; top:6px; right:6px; display:flex; gap:6px; z-index:10; }
  .cb { background:rgba(0,0,0,.5); border:none; color:white; padding:4px 10px; border-radius:4px; cursor:pointer; }
  #start-overlay { position:absolute; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:50; cursor:pointer; font-size:64px; }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="game-canvas" width="480" height="360"></canvas>
  <div id="variable-overlay"></div>
  <div id="ask-overlay" class="hidden">
    <span id="ask-prompt"></span>
    <div id="ask-row">
      <input type="text" id="ask-input">
      <button id="ask-submit">OK</button>
    </div>
  </div>
  <div id="controls">
    <button class="cb" onclick="startAll()">▶</button>
    <button class="cb" onclick="stopAll()">■</button>
  </div>
  <div id="start-overlay" onclick="startAll()">▶</div>
</div>
<script>
const __data__ = ${JSON.stringify(exportData)};
<\/script>
<script>
/* Embedded PyScratch engine */
const STAGE_WIDTH=480,STAGE_HEIGHT=360;
const collisionCanvas=document.createElement('canvas');
collisionCanvas.width=STAGE_WIDTH;collisionCanvas.height=STAGE_HEIGHT;
const collisionCtx=collisionCanvas.getContext('2d',{willReadFrequently:true});
let sprites=[],stage=null,isRunning=false,pressedKeys={},mouse={x:0,y:0,down:false},displayedVars={};
class Sprite{constructor(n,s=false){this.id=s?'stage':'s_'+Date.now()+Math.random();this.name=n;this.isStage=s;this.x=0;this.y=0;this.direction=90;this.size=100;this.visible=true;this.rotationStyle='all';this.costumes=[];this.currentCostumeIdx=0;this.code='';this.speechBubble={text:null};this.imgCache={};this._listeners={onClick:[],onKey:[],onMessage:[]};this._hitEdges={};}get currentCostume(){return this.costumes[this.currentCostumeIdx];}async loadImage(url){if(this.imgCache[url])return this.imgCache[url];return new Promise(r=>{const img=new Image();img.crossOrigin='Anonymous';img.onload=()=>{this.imgCache[url]=img;r(img);};img.onerror=()=>r(null);img.src=url;});}}
const canvas=document.getElementById('game-canvas');
const ctx=canvas.getContext('2d');
function drawSprite(s,tc,isSt=false){const c=s.currentCostume;if(!c)return;const img=s.imgCache[c.url];if(!img){s.loadImage(c.url);return;}tc.save();tc.translate(STAGE_WIDTH/2+s.x,STAGE_HEIGHT/2-s.y);if(!isSt){let r=(s.direction-90)*Math.PI/180;let sx=s.size/100,sy=s.size/100;if(s.rotationStyle==='none'){r=0;}else if(s.rotationStyle==='left-right'){r=0;let d=((s.direction%360)+360)%360;if(d>180)sx=-sx;}tc.rotate(r);tc.scale(sx,sy);tc.drawImage(img,-img.width/2,-img.height/2);}else{tc.scale(STAGE_WIDTH/img.width,STAGE_HEIGHT/img.height);tc.drawImage(img,-img.width/2,-img.height/2);}tc.restore();if(tc===ctx&&s.speechBubble.text){const bx=STAGE_WIDTH/2+s.x+20,by=STAGE_HEIGHT/2-s.y-44;ctx.font='12px sans-serif';const tw=ctx.measureText(String(s.speechBubble.text)).width+14;ctx.fillStyle='white';ctx.strokeStyle='#333';ctx.lineWidth=1.2;ctx.beginPath();ctx.roundRect(bx,by,tw,26,5);ctx.fill();ctx.stroke();ctx.fillStyle='#111';ctx.fillText(String(s.speechBubble.text),bx+7,by+17);}}
function renderLoop(){ctx.clearRect(0,0,480,360);if(stage&&stage.visible)drawSprite(stage,ctx,true);for(const s of sprites)if(s.visible)drawSprite(s,ctx);requestAnimationFrame(renderLoop);}
function spriteAt(s,mx,my){if(!s.visible)return false;const img=s.imgCache[s.currentCostume?.url];if(!img)return false;const r=Math.hypot(img.width,img.height)/2*(s.size/100);if(Math.hypot(mx-s.x,my-s.y)>r+4)return false;collisionCtx.clearRect(0,0,STAGE_WIDTH,STAGE_HEIGHT);drawSprite(s,collisionCtx);const px=Math.floor(STAGE_WIDTH/2+mx),py=Math.floor(STAGE_HEIGHT/2-my);if(px<0||px>=STAGE_WIDTH||py<0||py>=STAGE_HEIGHT)return false;return collisionCtx.getImageData(px,py,1,1).data[3]>0;}
function spritesOverlap(a,b){const ia=a.imgCache[a.currentCostume?.url];const ib=b.imgCache[b.currentCostume?.url];if(!ia||!ib)return false;const ra=Math.hypot(ia.width,ia.height)/2*(a.size/100);const rb=Math.hypot(ib.width,ib.height)/2*(b.size/100);if(Math.hypot(a.x-b.x,a.y-b.y)>ra+rb)return false;collisionCtx.clearRect(0,0,STAGE_WIDTH,STAGE_HEIGHT);drawSprite(a,collisionCtx);collisionCtx.globalCompositeOperation='source-in';drawSprite(b,collisionCtx);collisionCtx.globalCompositeOperation='source-over';const mnX=Math.max(0,Math.floor(STAGE_WIDTH/2+Math.min(a.x-ra,b.x-rb)));const mnY=Math.max(0,Math.floor(STAGE_HEIGHT/2-Math.max(a.y+ra,b.y+rb)));const mxX=Math.min(STAGE_WIDTH,Math.ceil(STAGE_WIDTH/2+Math.max(a.x+ra,b.x+rb)));const mxY=Math.min(STAGE_HEIGHT,Math.ceil(STAGE_HEIGHT/2-Math.min(a.y-ra,b.y-rb)));const w=mxX-mnX,h=mxY-mnY;if(w<=0||h<=0)return false;const d=collisionCtx.getImageData(mnX,mnY,w,h).data;for(let i=3;i<d.length;i+=4)if(d[i]>0)return true;return false;}
function updateVarDisplay(){const ov=document.getElementById('variable-overlay');ov.innerHTML='';for(const[k,v]of Object.entries(displayedVars)){const d=document.createElement('div');d.className='var-box';d.innerHTML='<span style="opacity:.8;margin-right:4px">'+k+'</span><span style="background:rgba(0,0,0,.3);padding:0 4px;border-radius:2px">'+v+'</span>';ov.appendChild(d);}}
function buildPyScratchModuleMin(sprite){function pyN(){return Sk.builtin.none.none$;}function pyB(v){return v?Sk.builtin.bool.true$:Sk.builtin.bool.false$;}function pyF(v){return new Sk.builtin.float_(v);}function jsN(v){return Sk.ffi.remapToJs(v);}function jsS(v){return Sk.ffi.remapToJs(v);}function sus(p){const s=new Sk.misceval.Suspension();s.resume=()=>p;s.data={type:'Sk.promise',promise:p};return s;}const d={};d.move_steps=new Sk.builtin.func(function(s){const n=jsN(s);const r=(90-sprite.direction)*Math.PI/180;sprite.x+=n*Math.cos(r);sprite.y+=n*Math.sin(r);return pyN();});d.turn=new Sk.builtin.func(function(dg){sprite.direction+=jsN(dg);return pyN();});d.go_to=new Sk.builtin.func(function(x,y){if(Sk.ffi.remapToJs(x)==='random'){sprite.x=Math.random()*STAGE_WIDTH-STAGE_WIDTH/2;sprite.y=Math.random()*STAGE_HEIGHT-STAGE_HEIGHT/2;}else{sprite.x=jsN(x);sprite.y=jsN(y);}return pyN();});d.set_x=new Sk.builtin.func(function(v){sprite.x=jsN(v);return pyN();});d.set_y=new Sk.builtin.func(function(v){sprite.y=jsN(v);return pyN();});d.change_x=new Sk.builtin.func(function(v){sprite.x+=jsN(v);return pyN();});d.change_y=new Sk.builtin.func(function(v){sprite.y+=jsN(v);return pyN();});d.get_x=new Sk.builtin.func(function(){return pyF(sprite.x);});d.get_y=new Sk.builtin.func(function(){return pyF(sprite.y);});d.get_direction=new Sk.builtin.func(function(){return pyF(sprite.direction);});d.on_edge=new Sk.builtin.func(function(){sprite._hitEdges={};const img=sprite.imgCache[sprite.currentCostume?.url];if(!img)return pyB(false);const diag=Math.hypot(img.width,img.height)/2;const radius=diag*(sprite.size/100);const hw=STAGE_WIDTH/2,hh=STAGE_HEIGHT/2;if(sprite.x>-hw+radius&&sprite.x<hw-radius&&sprite.y>-hh+radius&&sprite.y<hh-radius)return pyB(false);collisionCtx.clearRect(0,0,STAGE_WIDTH,STAGE_HEIGHT);drawSprite(sprite,collisionCtx);const chk=(x,y,w,h)=>{const dd=collisionCtx.getImageData(x,y,w,h).data;for(let i=3;i<dd.length;i+=4)if(dd[i]>0)return true;return false;};let hit=false;if(chk(0,0,STAGE_WIDTH,1)){sprite._hitEdges.top=true;hit=true;}if(chk(0,STAGE_HEIGHT-1,STAGE_WIDTH,1)){sprite._hitEdges.bottom=true;hit=true;}if(chk(0,0,1,STAGE_HEIGHT)){sprite._hitEdges.left=true;hit=true;}if(chk(STAGE_WIDTH-1,0,1,STAGE_HEIGHT)){sprite._hitEdges.right=true;hit=true;}if(!hit){if(sprite.x<-hw){sprite._hitEdges.left=true;hit=true;}if(sprite.x>hw){sprite._hitEdges.right=true;hit=true;}if(sprite.y<-hh){sprite._hitEdges.bottom=true;hit=true;}if(sprite.y>hh){sprite._hitEdges.top=true;hit=true;}}return pyB(hit);});d.bounce=new Sk.builtin.func(function(){const edges=sprite._hitEdges||{};const rad=sprite.direction*Math.PI/180;const vx=Math.sin(rad),vy=Math.cos(rad);if((edges.left&&vx<0)||(edges.right&&vx>0))sprite.direction=-sprite.direction;if((edges.top&&vy>0)||(edges.bottom&&vy<0))sprite.direction=180-sprite.direction;return pyN();});d.point_towards=new Sk.builtin.func(function(a,b){const av=Sk.ffi.remapToJs(a);if(b===undefined||b===Sk.builtin.none.none$){if(typeof av==='number'){sprite.direction=av;return pyN();}if(av==='mouse pointer'||av==='mouse_pointer'){const dx=mouse.x-sprite.x,dy=mouse.y-sprite.y;sprite.direction=90-Math.atan2(dy,dx)*180/Math.PI;return pyN();}const t=sprites.find(s=>s.name===av);if(t){const dx=t.x-sprite.x,dy=t.y-sprite.y;sprite.direction=90-Math.atan2(dy,dx)*180/Math.PI;}return pyN();}const tx=jsN(a),ty=jsN(b);sprite.direction=90-Math.atan2(ty-sprite.y,tx-sprite.x)*180/Math.PI;return pyN();});d.say=new Sk.builtin.func(function(msg,secs){sprite.speechBubble.text=Sk.ffi.remapToJs(msg);const ms=(secs!==undefined?jsN(secs):2)*1000;return sus(new Promise(r=>setTimeout(()=>{sprite.speechBubble.text=null;r(pyN());},ms)));});d.set_costume=new Sk.builtin.func(function(name){const n=jsS(name);const idx=sprite.costumes.findIndex(c=>c.name===n);if(idx>=0)sprite.currentCostumeIdx=idx;return pyN();});d.next_costume=new Sk.builtin.func(function(){sprite.currentCostumeIdx=(sprite.currentCostumeIdx+1)%sprite.costumes.length;return pyN();});d.set_stage=new Sk.builtin.func(function(name){const n=jsS(name);const idx=stage.costumes.findIndex(c=>c.name===n);if(idx>=0)stage.currentCostumeIdx=idx;return pyN();});d.next_stage=new Sk.builtin.func(function(){stage.currentCostumeIdx=(stage.currentCostumeIdx+1)%stage.costumes.length;return pyN();});d.set_size=new Sk.builtin.func(function(v){sprite.size=jsN(v);return pyN();});d.change_size=new Sk.builtin.func(function(v){sprite.size+=jsN(v);return pyN();});d.show=new Sk.builtin.func(function(){sprite.visible=true;return pyN();});d.hide=new Sk.builtin.func(function(){sprite.visible=false;return pyN();});d.glide_to=new Sk.builtin.func(function(x,y,secs){let tx=Sk.ffi.remapToJs(x),ty,dur;if(tx==='random'){tx=Math.random()*STAGE_WIDTH-STAGE_WIDTH/2;ty=Math.random()*STAGE_HEIGHT-STAGE_HEIGHT/2;dur=jsN(y);}else{tx=jsN(x);ty=jsN(y);dur=jsN(secs);}const sx=sprite.x,sy=sprite.y,st=Date.now(),ms=dur*1000;return sus(new Promise(r=>{const step=()=>{if(!isRunning)return r(pyN());const p=Math.min(1,(Date.now()-st)/ms);sprite.x=sx+(tx-sx)*p;sprite.y=sy+(ty-sy)*p;if(p<1)requestAnimationFrame(step);else r(pyN());};requestAnimationFrame(step);}));});d.wait=new Sk.builtin.func(function(secs){const ms=jsN(secs)*1000;return sus(new Promise(r=>setTimeout(()=>r(pyN()),ms)));});d.stop=new Sk.builtin.func(function(){stopAll();return pyN();});d.broadcast=new Sk.builtin.func(function(msg){const m=jsS(msg);for(const s of[stage,...sprites]){if(s._listeners.onMessage)s._listeners.onMessage.forEach(fn=>fn(m));}return pyN();});d.touching=new Sk.builtin.func(function(target){const t=jsS(target);if(t==='mouse_pointer'||t==='mouse pointer')return pyB(spriteAt(sprite,mouse.x,mouse.y));const tSpr=sprites.find(s=>s.name===t);if(!tSpr)return pyB(false);return pyB(spritesOverlap(sprite,tSpr));});d.distance_to=new Sk.builtin.func(function(target){const t=jsS(target);let tx,ty;if(t==='mouse_pointer'||t==='mouse pointer'){tx=mouse.x;ty=mouse.y;}else{const s=sprites.find(s=>s.name===t);if(!s)return pyF(9999);tx=s.x;ty=s.y;}return pyF(Math.hypot(sprite.x-tx,sprite.y-ty));});d.key_pressed=new Sk.builtin.func(function(key){return pyB(!!pressedKeys[jsS(key)]);});d.ask=new Sk.builtin.func(function(question){const ov=document.getElementById('ask-overlay');const pr=document.getElementById('ask-prompt');const inp=document.getElementById('ask-input');const btn=document.getElementById('ask-submit');pr.textContent=sprite.name+' asks: '+jsS(question);ov.classList.remove('hidden');inp.value='';inp.focus();return sus(new Promise(resolve=>{const submit=()=>{ov.classList.add('hidden');resolve(new Sk.builtin.str(inp.value));btn.removeEventListener('click',submit);};btn.addEventListener('click',submit);inp.addEventListener('keydown',function kd(e){if(e.key==='Enter'){submit();inp.removeEventListener('keydown',kd);}});})  );});d.display_variable=new Sk.builtin.func(function(name,val){displayedVars[jsS(name)]=Sk.ffi.remapToJs(val);updateVarDisplay();return pyN();});d.hide_variable=new Sk.builtin.func(function(name){delete displayedVars[jsS(name)];updateVarDisplay();return pyN();});return d;}
function builtinRead(fname){if(fname==='pyscratch.js' || fname==='src/lib/pyscratch.js'){return 'var $builtinmodule=function(name){var d=Sk.__pyscratch_api__;d["__name__"]=new Sk.builtin.str("pyscratch");d["__all__"]=new Sk.builtin.list(Object.keys(d).filter(function(k){return k.indexOf("__")!==0;}).map(function(k){return new Sk.builtin.str(k);}));return d;};';}if(Sk.builtinFiles&&Sk.builtinFiles.files&&Sk.builtinFiles.files[fname])return Sk.builtinFiles.files[fname];throw new Error('File not found: '+fname);}
function runSpriteCode(sprite){if(!sprite.code||!sprite.code.trim())return;sprite._listeners={onClick:[],onKey:[],onMessage:[]};Sk.__pyscratch_api__=buildPyScratchModuleMin(sprite);Sk.configure({output:t=>{console.log(t);},read:builtinRead,__future__:Sk.python3,execLimit:undefined,killableWhile:true,killableFor:true});const fsh={'Sk.delay':s=>new Promise((res,rej)=>{requestAnimationFrame(()=>{if(!isRunning){rej('__stopped__');return;}try{res(s.resume());}catch(e){rej(e);}});}), 'Sk.yield':s=>new Promise((res,rej)=>{requestAnimationFrame(()=>{if(!isRunning){rej('__stopped__');return;}try{res(s.resume());}catch(e){rej(e);}});})};const ss=e=>e==='__stopped__';const userCode=sprite.code.replace(/^\s*from\s+pyscratch\s+import\s+\*\s*\n?/gm,'');const codeToRun='from pyscratch import *\n'+userCode;Sk.misceval.asyncToPromise(()=>Sk.importMainWithBody('<stdin>',false,codeToRun,true),fsh).then(mod=>{const d=mod.$d;if(d.game_start&&isRunning)Sk.misceval.asyncToPromise(()=>Sk.misceval.callsimOrSuspendArray(d.game_start,[]),fsh).catch(e=>{if(!ss(e))console.error(e);});if(d.on_click)sprite._listeners.onClick.push(()=>{if(!isRunning)return;Sk.misceval.asyncToPromise(()=>Sk.misceval.callsimOrSuspendArray(d.on_click,[]),fsh).catch(e=>{if(!ss(e))console.error(e);});});if(d.on_keypress)sprite._listeners.onKey.push(key=>{if(!isRunning)return;Sk.misceval.asyncToPromise(()=>Sk.misceval.callsimOrSuspendArray(d.on_keypress,[new Sk.builtin.str(key)]),fsh).catch(e=>{if(!ss(e))console.error(e);});});if(d.broadcast_receive)sprite._listeners.onMessage.push(msg=>{if(!isRunning)return;Sk.misceval.asyncToPromise(()=>Sk.misceval.callsimOrSuspendArray(d.broadcast_receive,[new Sk.builtin.str(msg)]),fsh).catch(e=>{if(!ss(e))console.error(e);});});}).catch(e=>{if(!ss(e))console.error('Error in '+sprite.name+': '+e);});}
function stopAll(){isRunning=false;window.isRunning=false;}
function startAll(){stopAll();displayedVars={};updateVarDisplay();pressedKeys={};document.getElementById('start-overlay').style.display='none';setTimeout(()=>{isRunning=true;window.isRunning=true;[stage,...sprites].forEach(s=>s._listeners={onClick:[],onKey:[],onMessage:[]});[stage,...sprites].forEach(s=>runSpriteCode(s));},80);}
const canvas2=document.getElementById('game-canvas');canvas2.addEventListener('mousemove',e=>{const r=canvas2.getBoundingClientRect();const sx=STAGE_WIDTH/r.width,sy=STAGE_HEIGHT/r.height;mouse.x=(e.clientX-r.left)*sx-STAGE_WIDTH/2;mouse.y=-((e.clientY-r.top)*sy-STAGE_HEIGHT/2);});canvas2.addEventListener('mousedown',()=>{mouse.down=true;if(isRunning)[stage,...sprites].forEach(s=>{let hit=s.isStage||spriteAt(s,mouse.x,mouse.y);if(hit)s._listeners.onClick.forEach(fn=>fn());});});canvas2.addEventListener('mouseup',()=>mouse.down=false);
const normKey=k=>{if(k===' ')return'space';if(k==='ArrowUp')return'up';if(k==='ArrowDown')return'down';if(k==='ArrowLeft')return'left';if(k==='ArrowRight')return'right';if(k==='Enter')return'enter';return k.toLowerCase();};
window.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;const key=normKey(e.key);if(pressedKeys[key])return;pressedKeys[key]=true;if(isRunning)[stage,...sprites].forEach(s=>s._listeners.onKey.forEach(fn=>fn(key)));});
window.addEventListener('keyup',e=>{pressedKeys[normKey(e.key)]=false;});
// Boot
window.onload=()=>{stage=Object.assign(new Sprite('Stage',true),__data__.stage,{imgCache:{},_listeners:{onClick:[],onKey:[],onMessage:[]},_hitEdges:{}});sprites=__data__.sprites.map(sd=>{const s=Object.assign(new Sprite(sd.name),sd,{imgCache:{},_listeners:{onClick:[],onKey:[],onMessage:[]},_hitEdges:{}});return s;});renderLoop();};
<\/script>
</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pyscratch-game.html'; a.click();
}

function toggleFullscreen() {
  const w = document.getElementById('stage-wrap');
  if (!document.fullscreenElement) w.requestFullscreen(); else document.exitFullscreen();
}

// ─────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────
window.onload = async () => {
  // Create stage and default sprite
  stage = new Sprite('Stage', true);
  const sp1 = new Sprite('Sprite1');
  sprites.push(sp1);

  // Load asset libraries
  try {
    const fetchLib = async url => {
      const r = await fetch(url);
      const t = await r.text();
      return t.split('\n').filter(l => l.trim()).map(l => l.trim() + '/get/');
    };
    window.spriteLibUrls = await fetchLib(URLS.SPRITE_LIB);
    window.stageLibUrls  = await fetchLib(URLS.STAGE_LIB);
  } catch {
    window.spriteLibUrls = [URLS.DEFAULT_SPRITE];
    window.stageLibUrls  = [URLS.DEFAULT_STAGE];
  }

  activeEditorSprId = sp1.id;
  currentSelection  = sp1.id;

  renderEditorTabs();
  loadEditorForSprite(sp1);
  renderSpriteList();
  updatePropBar();
  setupInputs();
  renderLoop();

  consoleLog('PyScratch ready — write Python and press Run ▶', 'info');
  consoleLog('Use: from pyscratch import *', 'info');
};

// Expose globals needed for HTML event handlers
window.startAll = startAll; window.stopAll = stopAll;
window.switchRightTab = switchRightTab; window.showHelp = showHelp;
window.saveProject = saveProject; window.loadProject = loadProject;
window.publishProject = publishProject; window.toggleFullscreen = toggleFullscreen;
window.selectSprite = selectSprite; window.updateSpriteProp = updateSpriteProp;
window.createNewSprite = createNewSprite; window.deleteSprite = deleteSprite;
window.renderSpriteList = renderSpriteList;
window.openLibraryForAdd = openLibraryForAdd; window.removeCostume = removeCostume;
window.clearConsole = clearConsole;
window.showCustomConfirm = showCustomConfirm; window.showAlert = showAlert;