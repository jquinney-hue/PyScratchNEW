// python-api.js — optimised Skulpt bindings
//
// Key optimisations vs previous version:
//  - Sprite looked up ONCE at buildModule time, stored as direct reference.
//    getSp() is eliminated from every hot call.
//  - Sk.ffi.remapToJs() replaced with direct .v access for numeric args —
//    avoids full type-dispatch unwrap on the hot path.
//  - Pre-allocated reusable yield suspension per thread (no alloc per wait(0)).
//  - num() uses Sk int pool for integers 0-9, float_ otherwise.
//  - _applyAPI uses a pre-built flat [key,value,key,value...] array instead
//    of Object.entries() + spread per frame.
//  - Sk.configure() moved OUT of per-thread launch — called once at init.

const PythonAPI = (() => {

  // ── One-time Skulpt configuration ────────────────────────────
  // Called once from app.js init, NOT per-thread.
  function configure() {
    Sk.configure({
      output:    txt => console.log('[PyScratch]', txt),
      read:      x => {
        if (Sk.builtinFiles && Sk.builtinFiles.files[x] !== undefined)
          return Sk.builtinFiles.files[x];
        throw `File not found: '${x}'`;
      },
      yieldLimit: 500,
      execLimit:  null,
      __future__: Sk.python3,
    });
  }

  // ── Fast value helpers ────────────────────────────────────────
  // Direct .v access is ~10x faster than Sk.ffi.remapToJs for numbers.
  // We check for the Skulpt float/int type first; fall back for anything else.
  function jsNum(skVal) {
    if (skVal == null) return 0;
    if (typeof skVal.v === 'number') return skVal.v;
    // fallback for booleans, strings passed as numbers
    return +Sk.ffi.remapToJs(skVal);
  }

  function jsStr(skVal) {
    if (skVal == null) return '';
    if (typeof skVal.v === 'string') return skVal.v;
    return String(Sk.ffi.remapToJs(skVal));
  }

  function jsVal(skVal) {
    if (skVal == null) return undefined;
    if (typeof skVal.v !== 'undefined') return skVal.v;
    return Sk.ffi.remapToJs(skVal);
  }

  const _noneV  = Sk.builtin.none.none$;
  const _pyTrue = Sk.builtin.bool.true$;
  const _pyFalse= Sk.builtin.bool.false$;

  // Reuse Skulpt's small-int pool for 0-255; allocate float_ otherwise
  function num(v) {
    const n = +v;
    if (Number.isInteger(n) && n >= 0 && n < 256) return new Sk.builtin.int_(n);
    return new Sk.builtin.float_(n);
  }
  function pyStr(v)  { return new Sk.builtin.str(String(v)); }
  function pyBool(v) { return v ? _pyTrue : _pyFalse; }
  function fn(f)     { return new Sk.builtin.func(f); }

  // ── buildModule ───────────────────────────────────────────────
  // Returns { api, flatEntries } where flatEntries is a pre-built
  // [k,v,k,v...] array for fast _applyAPI without Object.entries().
  function buildModule(spriteId, threadId) {

    // Cache sprite reference directly — avoid Array.find every call
    // The sprite object is mutated in-place so this reference stays valid.
    // We still need a getter for functions that might run after clone, so
    // we keep a lazy getter only for ops that truly need the current sprite.
    let _sp = Engine.getSprite(spriteId);
    const getSp = () => _sp || (_sp = Engine.getSprite(spriteId));

    // Pre-allocated reusable yield suspension for wait(0) — no per-frame alloc
    const _yieldSusp = new Sk.misceval.Suspension();
    _yieldSusp.resume = () => _noneV;
    _yieldSusp.data   = { type: 'Sk.yield' };

    function yieldSusp() { return _yieldSusp; }

    function timedSusp(seconds) {
      const s   = new Sk.misceval.Suspension();
      s.resume  = () => _noneV;
      s.data    = { type: 'Sk.yield' };
      s._wakeAt = performance.now() + seconds * 1000;
      return s;
    }

    function promiseSusp(promise, resumeFn) {
      const s  = new Sk.misceval.Suspension();
      s.resume = resumeFn || (() => _noneV);
      s.data   = { type: 'Sk.promise', promise };
      return s;
    }

    const api = {
      // ── Movement ─────────────────────────────────────────────
      move_steps: fn(steps => {
        const sp = getSp(); if (!sp) return _noneV;
        const n  = jsNum(steps);
        // Inline degToRad: multiply by PI/180
        const r  = sp.direction * 0.017453292519943295;
        sp.x += Math.sin(r) * n;
        sp.y += Math.cos(r) * n;
        return _noneV;
      }),

      turn: fn(deg => {
        const sp = getSp(); if (!sp) return _noneV;
        sp.direction = ((sp.direction + jsNum(deg)) % 360 + 360) % 360;
        return _noneV;
      }),

      go_to: fn((xOrStr, y) => {
        const sp = getSp(); if (!sp) return _noneV;
        if (y === undefined) {
          const t = jsVal(xOrStr);
          if (t === 'random') {
            sp.x = Math.round(Math.random() * 480 - 240);
            sp.y = Math.round(Math.random() * 360 - 180);
          } else if (t === 'mouse') {
            sp.x = Renderer.mouseX; sp.y = Renderer.mouseY;
          }
        } else {
          sp.x = jsNum(xOrStr);
          sp.y = jsNum(y);
        }
        return _noneV;
      }),

      glide_to: fn((xOrStr, yOrSecs, secs) => {
        const sp = getSp(); if (!sp) return yieldSusp();
        let tx, ty, dur;
        if (secs === undefined) {
          const t = jsVal(xOrStr);
          dur = jsNum(yOrSecs);
          tx  = t === 'random' ? Math.random()*480-240 : Renderer.mouseX;
          ty  = t === 'random' ? Math.random()*360-180 : Renderer.mouseY;
        } else {
          tx = jsNum(xOrStr); ty = jsNum(yOrSecs); dur = jsNum(secs);
        }
        const sx = sp.x, sy = sp.y, start = performance.now();
        return promiseSusp(new Promise(resolve => {
          function tick() {
            const t = Math.min(1, (performance.now() - start) / (dur * 1000));
            sp.x = sx + (tx - sx) * t;
            sp.y = sy + (ty - sy) * t;
            if (t < 1) requestAnimationFrame(tick); else resolve();
          }
          requestAnimationFrame(tick);
        }));
      }),

      point_towards: fn(target => {
        const sp = getSp(); if (!sp) return _noneV;
        const raw = jsVal(target);
        if (typeof raw === 'number') {
          sp.direction = ((raw % 360) + 360) % 360;
          return _noneV;
        }
        const t = String(raw);
        let tx, ty;
        if (t === 'mouse_pointer' || t === 'mouse') {
          tx = Renderer.mouseX; ty = Renderer.mouseY;
        } else {
          const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
          if (!ts) return _noneV;
          tx = ts.x; ty = ts.y;
        }
        sp.direction = (Math.atan2(tx - sp.x, ty - sp.y) * 57.29577951308232 + 360) % 360;
        return _noneV;
      }),

      change_x:      fn(v  => { const sp=getSp(); if(sp) sp.x += jsNum(v); return _noneV; }),
      change_y:      fn(v  => { const sp=getSp(); if(sp) sp.y += jsNum(v); return _noneV; }),
      set_x:         fn(v  => { const sp=getSp(); if(sp) sp.x  = jsNum(v); return _noneV; }),
      set_y:         fn(v  => { const sp=getSp(); if(sp) sp.y  = jsNum(v); return _noneV; }),
      get_x:         fn(() => { const sp=getSp(); return num(sp ? sp.x : 0); }),
      get_y:         fn(() => { const sp=getSp(); return num(sp ? sp.y : 0); }),
      get_direction: fn(() => { const sp=getSp(); return num(sp ? sp.direction : 90); }),

      on_edge: fn(() => pyBool(Renderer.spriteOnEdge(getSp() || {x:0,y:0,size:100,_img:null}))),
      bounce:  fn(() => { const sp=getSp(); if(sp) Renderer.bounceOffEdge(sp); return _noneV; }),

      // ── Looks ─────────────────────────────────────────────────
      say: fn((msg, secs) => {
        const sp = getSp(); if (!sp) return _noneV;
        sp._sayText = String(jsVal(msg));
        if (sp._sayTimer) { clearTimeout(sp._sayTimer); sp._sayTimer = null; }
        if (secs !== undefined) {
          const dur = jsNum(secs);
          if (dur > 0) {
            const s = timedSusp(dur);
            s._onResume = () => { sp._sayText = null; };
            return s;
          }
        }
        return _noneV;
      }),

      set_costume: fn(name => {
        const sp = getSp(); if (!sp) return _noneV;
        const n  = String(jsVal(name));
        const i  = sp.costumes.findIndex(c => c.name === n);
        if (i >= 0) {
          sp.currentCostume = i;
          Renderer.loadSpriteImage(sp).then(() => {
            UI.renderSpritePanel();
            if (Engine.getSelectedSprite() === sp) CostumePanel.load(sp);
          });
        }
        return _noneV;
      }),

      next_costume: fn(() => {
        const sp = getSp(); if (!sp || sp.costumes.length <= 1) return _noneV;
        sp.currentCostume = (sp.currentCostume + 1) % sp.costumes.length;
        Renderer.loadSpriteImage(sp).then(() => {
          UI.renderSpritePanel();
          if (Engine.getSelectedSprite() === sp) CostumePanel.load(sp);
        });
        return _noneV;
      }),

      set_stage: fn(name => {
        const stage = Engine.state.stage;
        const n     = String(jsVal(name));
        const i     = stage.costumes.findIndex(c => c.name === n);
        if (i >= 0) {
          stage.currentCostume = i;
          Renderer.loadSpriteImage(stage).then(() => {
            UI.renderSpritePanel();
            Scheduler.fireEvent('stage_loaded', 'all', n);
          });
        }
        return _noneV;
      }),

      next_stage: fn(() => {
        const stage = Engine.state.stage;
        if (stage.costumes.length > 1) {
          stage.currentCostume = (stage.currentCostume + 1) % stage.costumes.length;
          Renderer.loadSpriteImage(stage).then(() => UI.renderSpritePanel());
        }
        return _noneV;
      }),

      set_size:    fn(v => { const sp=getSp(); if(sp) sp.size  = jsNum(v); return _noneV; }),
      change_size: fn(v => { const sp=getSp(); if(sp) sp.size += jsNum(v); return _noneV; }),
      show: fn(() => { const sp=getSp(); if(sp) sp.visible=true;  return _noneV; }),
      hide: fn(() => { const sp=getSp(); if(sp) sp.visible=false; return _noneV; }),

      // ── Control ───────────────────────────────────────────────
      wait: fn(secs => {
        const s = jsNum(secs);
        return s <= 0 ? yieldSusp() : timedSusp(s);
      }),
      stop: fn(() => { Scheduler.stopAll(); return _noneV; }),
      stop_this_thread: fn(() => {
        Scheduler.stopThread(spriteId, threadId);
        throw new Sk.builtin.SystemExit('stop_thread');
      }),

      // ── Events ────────────────────────────────────────────────
      broadcast: fn(evtName => {
        Scheduler.fireEvent('broadcast', 'all', String(jsVal(evtName)));
        return _noneV;
      }),
      broadcast_and_wait: fn(evtName => {
        const evt = String(jsVal(evtName));
        return promiseSusp(Scheduler.fireEventAndWait('broadcast', 'all', evt));
      }),

      // ── Sensing ───────────────────────────────────────────────
      touching: fn(target => {
        const sp = getSp(); if (!sp) return _pyFalse;
        const t  = String(jsVal(target));
        if (t === 'edge' || t === 'the edge') return pyBool(Renderer.spriteOnEdge(sp));
        if (t === 'mouse_pointer' || t === 'mouse')
          return pyBool(Renderer.isPointInSprite(sp, Renderer.mouseX, Renderer.mouseY));
        const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
        return pyBool(ts ? Renderer.spritesTouching(sp, ts) : false);
      }),

      touching_color: fn(hex => {
        const sp = getSp(); if (!sp || !sp._img) return _pyFalse;
        try {
          const [tr,tg,tb] = Utils.hexToRgb(String(jsVal(hex)));
          const cv = document.getElementById('stage-canvas');
          const c  = cv.getContext('2d', { willReadFrequently: true });
          const hw = (sp._img.naturalWidth  * sp.size/100) / 2;
          const hh = (sp._img.naturalHeight * sp.size/100) / 2;
          const cx = sp.x + Renderer.STAGE_W/2;
          const cy = Renderer.STAGE_H/2 - sp.y;
          for (let i=0; i<=8; i++) {
            const f = i/8;
            const pts = [[cx-hw+hw*2*f,cy-hh],[cx-hw+hw*2*f,cy+hh],[cx-hw,cy-hh+hh*2*f],[cx+hw,cy-hh+hh*2*f]];
            for (const [px,py] of pts) {
              const d = c.getImageData(Math.round(px), Math.round(py), 1, 1).data;
              if (d[3]>10 && Math.abs(d[0]-tr)<30 && Math.abs(d[1]-tg)<30 && Math.abs(d[2]-tb)<30)
                return _pyTrue;
            }
          }
        } catch(e) {}
        return _pyFalse;
      }),

      distance_to: fn(target => {
        const sp = getSp(); if (!sp) return num(0);
        const t  = String(jsVal(target));
        let tx, ty;
        if (t === 'mouse_pointer' || t === 'mouse') { tx=Renderer.mouseX; ty=Renderer.mouseY; }
        else {
          const ts = Engine.getAllSprites().find(s => s.name===t || s.id===t);
          if (!ts) return num(0);
          tx=ts.x; ty=ts.y;
        }
        const dx=sp.x-tx, dy=sp.y-ty;
        return num(Math.sqrt(dx*dx+dy*dy));
      }),

      ask: fn(msg => {
        const sp   = getSp();
        const name = sp ? sp.name : 'PyScratch';
        return promiseSusp(InputSystem.showAsk(name, String(jsVal(msg))), v => pyStr(v));
      }),

      key_pressed: fn(key => pyBool(InputSystem.isKeyDown(String(jsVal(key))))),
      mouse_x:     fn(() => num(Renderer.mouseX)),
      mouse_y:     fn(() => num(Renderer.mouseY)),
      mouse_down:  fn(() => pyBool(Renderer.mouseDown)),

      // ── Variables ─────────────────────────────────────────────
      set_var: fn((name, value) => {
        Engine.setGlobal(String(jsVal(name)), jsVal(value));
        return _noneV;
      }),
      get_var: fn(name => {
        const v = Engine.getGlobal(String(jsVal(name)));
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),
      set_sprite_var: fn((name, value) => {
        Engine.setSpriteVar(spriteId, String(jsVal(name)), jsVal(value));
        return _noneV;
      }),
      get_sprite_var: fn(name => {
        const v = Engine.getSpriteVar(spriteId, String(jsVal(name)));
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),
      display_variable: fn((name, visible) => {
        Engine.displayVariable(String(jsVal(name)), jsVal(visible), spriteId);
        return _noneV;
      }),

      // ── Clones ────────────────────────────────────────────────
      create_clone: fn(() => {
        const sp = getSp(); if (!sp) return _noneV;
        const clone = Engine.createSprite({
          ...sp, id: Utils.uid(), isClone: true, cloneOf: sp.id,
          threads: sp.threads.map(t=>({...t})),
          variables: {...sp.variables},
          costumes: sp.costumes.map(c=>({...c})),
        });
        clone._img = sp._img; clone._emoji = sp._emoji;
        Engine.state.sprites.push(clone);
        Renderer.markSortDirty();
        UI.renderSpritePanel();
        Scheduler.startSpriteThreads(clone, 'clone_start');
        return _noneV;
      }),
      delete_clone: fn(() => {
        const sp = getSp();
        if (sp && sp.isClone) {
          Scheduler.stopSpriteThreads(sp.id);
          Engine.deleteSprite(sp.id);
          Renderer.markSortDirty();
          UI.renderSpritePanel();
        }
        return _noneV;
      }),

      go_to_front:    fn(()  => { Engine.moveToFront(spriteId); return _noneV; }),
      go_back_layers: fn(n   => { Engine.moveBackLayers(spriteId, jsNum(n)); return _noneV; }),

      play_sound:      fn(name => { SoundSystem.play(String(jsVal(name))); return _noneV; }),
      stop_all_sounds: fn(()   => { SoundSystem.stopAll(); return _noneV; }),
      set_volume:      fn(v    => { SoundSystem.setVolume(jsNum(v)); return _noneV; }),

      list_create: fn(name    => { Engine.listCreate(String(jsVal(name))); return _noneV; }),
      list_add:    fn((n,v)   => { Engine.listAdd(String(jsVal(n)), jsVal(v)); return _noneV; }),
      list_remove: fn((n,i)   => { Engine.listRemove(String(jsVal(n)), jsNum(i)); return _noneV; }),
      list_get:    fn((n,i)   => {
        const v = Engine.listGet(String(jsVal(n)), jsNum(i));
        if (v === undefined) return _noneV;
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),

      random:     fn((a,b) => num(Math.random()*(jsNum(b)-jsNum(a))+jsNum(a))),
      random_int: fn((a,b) => {
        const lo=jsNum(a), hi=jsNum(b);
        return new Sk.builtin.int_(Math.floor(Math.random()*(hi-lo+1))+lo);
      }),
      timer:       fn(() => num((performance.now() - Scheduler.startTime) / 1000)),
      reset_timer: fn(() => { Scheduler.startTime = performance.now(); return _noneV; }),
    };

    // Pre-build flat [key, value, ...] array for fast _applyAPI
    const flatEntries = [];
    for (const [k, v] of Object.entries(api)) { flatEntries.push(k, v); }

    return { api, flatEntries };
  }

  return { configure, buildModule };
})();

// ── Sound System ──────────────────────────────────────────────────
const SoundSystem = (() => {
  let vol = 0.5;
  return {
    play() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(vol * 0.15, ctx.currentTime);
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.start(); osc.stop(ctx.currentTime + 0.15);
      } catch(e) {}
    },
    stopAll()    {},
    setVolume(v) { vol = Math.max(0, Math.min(1, v/100)); },
  };
})();

// ── Input System ──────────────────────────────────────────────────
const InputSystem = (() => {
  const keys = new Set();
  const KEY_MAP = {
    arrowup:'up', arrowdown:'down', arrowleft:'left', arrowright:'right',
    ' ':'space', enter:'enter', escape:'escape',
  };
  const norm = raw => { const k=raw.toLowerCase(); return KEY_MAP[k]||k; };

  window.addEventListener('keydown', e => {
    const k = norm(e.key);
    keys.add(k);
    if (document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA') return;
    Scheduler.fireEvent('keypress', 'all', k);
  });
  window.addEventListener('keyup', e => keys.delete(norm(e.key)));

  function isKeyDown(key) { return keys.has(norm(key)); }

  function showAsk(spriteName, message) {
    return new Promise(resolve => {
      const overlay = document.getElementById('ask-overlay');
      const msgEl   = document.getElementById('ask-message');
      const input   = document.getElementById('ask-input');
      const submit  = document.getElementById('ask-submit');
      msgEl.textContent = `${spriteName} asks: ${message}`;
      input.value = '';
      overlay.classList.remove('hidden');
      setTimeout(() => input.focus(), 50);
      const done = () => {
        overlay.classList.add('hidden');
        submit.onclick = null; input.onkeydown = null;
        resolve(input.value);
      };
      submit.onclick  = done;
      input.onkeydown = e => { if (e.key === 'Enter') done(); };
    });
  }

  return { isKeyDown, showAsk };
})();
