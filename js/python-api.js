// python-api.js — Skulpt Python→JS bindings

const PythonAPI = (() => {

  function buildModule(spriteId, threadId) {
    const getSp   = () => Engine.getSprite(spriteId);
    const none    = () => Sk.builtin.none.none$;
    const num     = v  => new Sk.builtin.float_(+v);
    const pyStr   = v  => new Sk.builtin.str(String(v));
    const pyBool  = v  => v ? Sk.builtin.bool.true$ : Sk.builtin.bool.false$;

    function makeSuspend(seconds) {
      const susp = new Sk.misceval.Suspension();
      susp.resume = () => Sk.builtin.none.none$;
      susp.data   = {
        type: 'Sk.promise',
        promise: new Promise(r => setTimeout(r, seconds * 1000))
      };
      return susp;
    }

    function fn(f) { return new Sk.builtin.func(f); }

    const api = {
      // ── Movement ───────────────────────────────────────────────
      move_steps: fn(steps => {
        const sp = getSp(); if (!sp) return none();
        const n   = +Sk.ffi.remapToJs(steps);
        // direction: 0=up, 90=right
        // dx = sin(dir), dy = cos(dir)  (Scratch convention)
        const rad = Utils.degToRad(sp.direction);
        sp.x += Math.sin(rad) * n;
        sp.y += Math.cos(rad) * n;
        return none();
      }),

      turn: fn(degrees => {
        const sp = getSp(); if (!sp) return none();
        sp.direction = ((sp.direction + +Sk.ffi.remapToJs(degrees)) % 360 + 360) % 360;
        return none();
      }),

      go_to: fn((xOrStr, y) => {
        const sp = getSp(); if (!sp) return none();
        if (y === undefined) {
          const t = Sk.ffi.remapToJs(xOrStr);
          if (t === 'random') {
            sp.x = Math.round(Math.random() * 480 - 240);
            sp.y = Math.round(Math.random() * 360 - 180);
          } else if (t === 'mouse') {
            sp.x = Renderer.mouseX; sp.y = Renderer.mouseY;
          }
        } else {
          sp.x = +Sk.ffi.remapToJs(xOrStr);
          sp.y = +Sk.ffi.remapToJs(y);
        }
        return none();
      }),

      glide_to: fn((xOrStr, yOrSecs, secs) => {
        const sp = getSp(); if (!sp) return makeSuspend(0);
        let tx, ty, dur;
        if (secs === undefined) {
          // glide_to("random", seconds)
          const t = Sk.ffi.remapToJs(xOrStr);
          dur = +Sk.ffi.remapToJs(yOrSecs);
          if (t === 'random') { tx = Math.random()*480-240; ty = Math.random()*360-180; }
          else { tx = Renderer.mouseX; ty = Renderer.mouseY; }
        } else {
          tx = +Sk.ffi.remapToJs(xOrStr);
          ty = +Sk.ffi.remapToJs(yOrSecs);
          dur = +Sk.ffi.remapToJs(secs);
        }
        const sx = sp.x, sy = sp.y;
        const start = Date.now();
        const susp = new Sk.misceval.Suspension();
        susp.data = {
          type: 'Sk.promise',
          promise: new Promise(resolve => {
            const tick = () => {
              const t = Math.min(1, (Date.now() - start) / (dur * 1000));
              sp.x = Utils.lerp(sx, tx, t);
              sp.y = Utils.lerp(sy, ty, t);
              if (t < 1) requestAnimationFrame(tick); else resolve();
            };
            tick();
          })
        };
        susp.resume = () => none();
        return susp;
      }),

      point_towards: fn(target => {
        const sp = getSp(); if (!sp) return none();
        const t = Sk.ffi.remapToJs(target);
        let tx, ty;
        if (t === 'mouse_pointer' || t === 'mouse') {
          tx = Renderer.mouseX; ty = Renderer.mouseY;
        } else {
          const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
          if (!ts) return none();
          tx = ts.x; ty = ts.y;
        }
        const dx = tx - sp.x, dy = ty - sp.y;
        // Scratch: 0=up → atan2(dx, dy) gives that
        sp.direction = (Utils.radToDeg(Math.atan2(dx, dy)) + 360) % 360;
        return none();
      }),

      change_x:    fn(v  => { const sp=getSp(); if(sp) sp.x += +Sk.ffi.remapToJs(v); return none(); }),
      change_y:    fn(v  => { const sp=getSp(); if(sp) sp.y += +Sk.ffi.remapToJs(v); return none(); }),
      set_x:       fn(v  => { const sp=getSp(); if(sp) sp.x  = +Sk.ffi.remapToJs(v); return none(); }),
      set_y:       fn(v  => { const sp=getSp(); if(sp) sp.y  = +Sk.ffi.remapToJs(v); return none(); }),
      get_x:       fn(() => { const sp=getSp(); return num(sp ? sp.x : 0); }),
      get_y:       fn(() => { const sp=getSp(); return num(sp ? sp.y : 0); }),
      get_direction: fn(() => { const sp=getSp(); return num(sp ? sp.direction : 90); }),

      // ── Edge & bounce ──────────────────────────────────────────
      on_edge: fn(() => pyBool(Renderer.spriteOnEdge(getSp() || {x:0,y:0,size:100,_img:null}))),
      bounce:  fn(() => { const sp=getSp(); if(sp) Renderer.bounceOffEdge(sp); return none(); }),

      // ── Looks ──────────────────────────────────────────────────
      say: fn((msg, secs) => {
        const sp = getSp(); if (!sp) return none();
        const text = Sk.ffi.remapToJs(msg);
        sp._sayText = String(text);
        if (sp._sayTimer) { clearTimeout(sp._sayTimer); sp._sayTimer = null; }
        if (secs !== undefined) {
          const dur = +Sk.ffi.remapToJs(secs);
          if (dur > 0) {
            sp._sayTimer = setTimeout(() => { sp._sayText = null; }, dur * 1000);
            return makeSuspend(dur);
          }
        }
        return none();
      }),

      set_costume: fn(name => {
        const sp = getSp(); if (!sp) return none();
        const n   = Sk.ffi.remapToJs(name);
        const idx = sp.costumes.findIndex(c => c.name === n || String(c.name) === String(n));
        if (idx >= 0) {
          sp.currentCostume = idx;
          Renderer.loadSpriteImage(sp).then(() => { UI.renderSpritePanel(); CostumePanel.load(sp); });
        }
        return none();
      }),

      next_costume: fn(() => {
        const sp = getSp(); if (!sp) return none();
        if (sp.costumes.length > 1) {
          sp.currentCostume = (sp.currentCostume + 1) % sp.costumes.length;
          Renderer.loadSpriteImage(sp).then(() => { UI.renderSpritePanel(); CostumePanel.load(sp); });
        }
        return none();
      }),

      set_stage: fn(name => {
        const stage = Engine.state.stage;
        const n     = Sk.ffi.remapToJs(name);
        const idx   = stage.costumes.findIndex(c => c.name === n);
        if (idx >= 0) {
          stage.currentCostume = idx;
          Renderer.loadSpriteImage(stage).then(() => {
            UI.renderSpritePanel();
            CostumePanel.load(stage);
            Scheduler.fireEvent('stage_loaded', 'all', n);
          });
        }
        return none();
      }),

      next_stage: fn(() => {
        const stage = Engine.state.stage;
        if (stage.costumes.length > 1) {
          stage.currentCostume = (stage.currentCostume + 1) % stage.costumes.length;
          Renderer.loadSpriteImage(stage).then(() => {
            UI.renderSpritePanel();
            CostumePanel.load(stage);
          });
        }
        return none();
      }),

      set_size:    fn(v => { const sp=getSp(); if(sp) sp.size  = +Sk.ffi.remapToJs(v); return none(); }),
      change_size: fn(v => { const sp=getSp(); if(sp) sp.size += +Sk.ffi.remapToJs(v); return none(); }),
      show: fn(() => { const sp=getSp(); if(sp) sp.visible=true;  return none(); }),
      hide: fn(() => { const sp=getSp(); if(sp) sp.visible=false; return none(); }),

      // ── Control ────────────────────────────────────────────────
      wait: fn(secs => makeSuspend(+Sk.ffi.remapToJs(secs))),

      stop: fn(() => { Scheduler.stopAll(); return none(); }),

      stop_this_thread: fn(() => {
        Scheduler.stopThread(spriteId, threadId);
        throw new Sk.builtin.SystemExit('stop_thread');
      }),

      // ── Events ─────────────────────────────────────────────────
      broadcast: fn(evtName => {
        Scheduler.fireEvent('broadcast', 'all', Sk.ffi.remapToJs(evtName));
        return none();
      }),

      broadcast_and_wait: fn(evtName => {
        const evt  = Sk.ffi.remapToJs(evtName);
        const susp = new Sk.misceval.Suspension();
        susp.data  = {
          type: 'Sk.promise',
          promise: Scheduler.fireEventAndWait('broadcast', 'all', evt)
        };
        susp.resume = () => none();
        return susp;
      }),

      // ── Sensing ────────────────────────────────────────────────
      touching: fn(target => {
        const sp = getSp(); if (!sp) return pyBool(false);
        const t  = Sk.ffi.remapToJs(target);
        if (t === 'edge' || t === 'the edge') return pyBool(Renderer.spriteOnEdge(sp));
        if (t === 'mouse_pointer' || t === 'mouse') {
          return pyBool(Renderer.isPointInSprite(sp, Renderer.mouseX, Renderer.mouseY));
        }
        const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
        return pyBool(ts ? Renderer.spritesTouching(sp, ts) : false);
      }),

      touching_color: fn(hex => {
        const sp = getSp(); if (!sp || !sp._img) return pyBool(false);
        // Sample pixels around sprite edges and check color match
        try {
          const [tr, tg, tb] = Utils.hexToRgb(Sk.ffi.remapToJs(hex));
          const cv = document.getElementById('stage-canvas');
          const c  = cv.getContext('2d', { willReadFrequently: true });
          const cx = sp.x + Renderer.STAGE_W / 2;
          const cy = Renderer.STAGE_H / 2 - sp.y;
          const hw = (sp._img.naturalWidth  * sp.size / 100) / 2;
          const hh = (sp._img.naturalHeight * sp.size / 100) / 2;
          // Sample 20 points along sprite bounding box perimeter
          const pts = [];
          for (let i = 0; i <= 4; i++) {
            const t = i / 4;
            pts.push([cx - hw + hw*2*t, cy - hh]);
            pts.push([cx - hw + hw*2*t, cy + hh]);
            pts.push([cx - hw, cy - hh + hh*2*t]);
            pts.push([cx + hw, cy - hh + hh*2*t]);
          }
          for (const [px, py] of pts) {
            const d = c.getImageData(Math.round(px), Math.round(py), 1, 1).data;
            if (Math.abs(d[0]-tr)<30 && Math.abs(d[1]-tg)<30 && Math.abs(d[2]-tb)<30 && d[3]>10) {
              return pyBool(true);
            }
          }
        } catch(e) {}
        return pyBool(false);
      }),

      distance_to: fn(target => {
        const sp = getSp(); if (!sp) return num(0);
        const t  = Sk.ffi.remapToJs(target);
        let tx, ty;
        if (t === 'mouse_pointer' || t === 'mouse') { tx=Renderer.mouseX; ty=Renderer.mouseY; }
        else {
          const ts = Engine.getAllSprites().find(s => s.name===t || s.id===t);
          if (!ts) return num(0);
          tx=ts.x; ty=ts.y;
        }
        return num(Utils.dist(sp.x, sp.y, tx, ty));
      }),

      ask: fn(msg => {
        const sp = getSp();
        const spriteName = sp ? sp.name : 'PyScratch';
        const message    = Sk.ffi.remapToJs(msg);
        const susp = new Sk.misceval.Suspension();
        susp.data  = { type: 'Sk.promise', promise: InputSystem.showAsk(spriteName, message) };
        susp.resume = v => pyStr(v);
        return susp;
      }),

      key_pressed: fn(key => pyBool(InputSystem.isKeyDown(Sk.ffi.remapToJs(key)))),
      mouse_x:     fn(() => num(Renderer.mouseX)),
      mouse_y:     fn(() => num(Renderer.mouseY)),
      mouse_down:  fn(() => pyBool(Renderer.mouseDown)),

      // ── Variables ──────────────────────────────────────────────
      set_var: fn((name, value) => {
        Engine.setGlobal(Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(value));
        return none();
      }),
      get_var: fn(name => {
        const v = Engine.getGlobal(Sk.ffi.remapToJs(name));
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),
      set_sprite_var: fn((name, value) => {
        Engine.setSpriteVar(spriteId, Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(value));
        return none();
      }),
      get_sprite_var: fn(name => {
        const v = Engine.getSpriteVar(spriteId, Sk.ffi.remapToJs(name));
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),
      display_variable: fn((name, visible) => {
        Engine.displayVariable(Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(visible), spriteId);
        return none();
      }),

      // ── Clones ─────────────────────────────────────────────────
      create_clone: fn(() => {
        const sp = getSp(); if (!sp) return none();
        const clone = Engine.createSprite({
          ...sp,
          id:       Utils.uid(),
          isClone:  true,
          cloneOf:  sp.id,
          threads:  sp.threads.map(t => ({ ...t })),
          variables: { ...sp.variables },
          costumes: sp.costumes.map(c => ({ ...c })),
        });
        clone._img   = sp._img;
        clone._emoji = sp._emoji;
        Engine.state.sprites.push(clone);
        Scheduler.startSpriteThreads(clone, 'clone_start');
        return none();
      }),

      delete_clone: fn(() => {
        const sp = getSp();
        if (sp && sp.isClone) {
          Scheduler.stopSpriteThreads(sp.id);
          Engine.deleteSprite(sp.id);
        }
        return none();
      }),

      // ── Layering ───────────────────────────────────────────────
      go_to_front:     fn(() => { Engine.moveToFront(spriteId);    return none(); }),
      go_back_layers:  fn(n  => { Engine.moveBackLayers(spriteId, +Sk.ffi.remapToJs(n)); return none(); }),

      // ── Sound ──────────────────────────────────────────────────
      play_sound:      fn(name => { SoundSystem.play(Sk.ffi.remapToJs(name)); return none(); }),
      stop_all_sounds: fn(()   => { SoundSystem.stopAll(); return none(); }),
      set_volume:      fn(v    => { SoundSystem.setVolume(+Sk.ffi.remapToJs(v)); return none(); }),

      // ── Lists ───────────────────────────────────────────────────
      list_create: fn(name  => { Engine.listCreate(Sk.ffi.remapToJs(name)); return none(); }),
      list_add:    fn((n,v) => { Engine.listAdd(Sk.ffi.remapToJs(n), Sk.ffi.remapToJs(v)); return none(); }),
      list_remove: fn((n,i) => { Engine.listRemove(Sk.ffi.remapToJs(n), +Sk.ffi.remapToJs(i)); return none(); }),
      list_get:    fn((n,i) => {
        const v = Engine.listGet(Sk.ffi.remapToJs(n), +Sk.ffi.remapToJs(i));
        if (v === undefined) return Sk.builtin.none.none$;
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),

      // ── Math / Misc ────────────────────────────────────────────
      random:     fn((a,b) => num(Math.random() * (+Sk.ffi.remapToJs(b) - +Sk.ffi.remapToJs(a)) + +Sk.ffi.remapToJs(a))),
      random_int: fn((a,b) => new Sk.builtin.int_(
        Math.floor(Math.random() * (+Sk.ffi.remapToJs(b) - +Sk.ffi.remapToJs(a) + 1)) + +Sk.ffi.remapToJs(a)
      )),
      timer:       fn(() => num((Date.now() - Scheduler.startTime) / 1000)),
      reset_timer: fn(() => { Scheduler.startTime = Date.now(); return none(); }),
    };

    return api;
  }

  function configure() {
    Sk.configure({
      output: text => console.log('[PyScratch]', text),
      read: x => {
        if (Sk.builtinFiles && Sk.builtinFiles.files[x] !== undefined)
          return Sk.builtinFiles.files[x];
        throw `File not found: '${x}'`;
      },
      execLimit: 200000,
      __future__: Sk.python3,
    });
  }

  async function runCode(code, spriteId, threadId) {
    configure();
    const api = buildModule(spriteId, threadId);

    // Inject all API functions as Skulpt builtins (accessible without import)
    for (const [k, v] of Object.entries(api)) {
      Sk.builtins[k] = v;
    }

    try {
      await Sk.misceval.asyncToPromise(() =>
        Sk.importMainWithBody('<main>', false, code, true)
      );
    } catch (err) {
      if (err instanceof Sk.builtin.SystemExit) return;
      const msg = err.toString ? err.toString() : String(err);
      if (msg.includes('stop_thread') || msg.includes('stop')) return;
      throw err;
    }
  }

  return { buildModule, runCode, configure };
})();

// ── Sound System ──────────────────────────────────────────────────
const SoundSystem = (() => {
  let volume = 0.5;
  function play(name) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(volume * 0.15, ctx.currentTime);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch(e) {}
  }
  return {
    play,
    stopAll:   () => {},
    setVolume: v => { volume = Utils.clamp(v / 100, 0, 1); },
  };
})();

// ── Input System ──────────────────────────────────────────────────
const InputSystem = (() => {
  const keys = new Set();

  window.addEventListener('keydown', e => {
    const k = normaliseKey(e);
    keys.add(k);
    Scheduler.fireEvent('keypress', 'all', k);
  });
  window.addEventListener('keyup', e => keys.delete(normaliseKey(e)));

  function normaliseKey(e) {
    const map = {
      ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
      ' ':'space', Enter:'enter', Escape:'escape',
    };
    return (map[e.key] || e.key).toLowerCase();
  }

  function isKeyDown(key) {
    const map = {
      arrowup:'up', arrowdown:'down', arrowleft:'left', arrowright:'right',
    };
    const k = (map[key.toLowerCase()] || key).toLowerCase();
    return keys.has(k);
  }

  function showAsk(spriteName, message) {
    return new Promise(resolve => {
      const overlay = document.getElementById('ask-overlay');
      const msgEl   = document.getElementById('ask-message');
      const input   = document.getElementById('ask-input');
      const submit  = document.getElementById('ask-submit');

      msgEl.textContent = `${spriteName} asks: ${message}`;
      input.value = '';
      overlay.classList.remove('hidden');
      input.focus();

      const done = () => {
        overlay.classList.add('hidden');
        submit.onclick = null;
        input.onkeydown = null;
        resolve(input.value);
      };

      submit.onclick  = done;
      input.onkeydown = e => { if (e.key === 'Enter') done(); };
    });
  }

  return { isKeyDown, showAsk };
})();
