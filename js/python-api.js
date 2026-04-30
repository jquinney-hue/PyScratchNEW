// python-api.js — builds the Skulpt builtins for a sprite/thread context
//
// Timing model:
//   wait(0)   → Sk.yield suspension  → resumes on next rAF frame (frame-locked)
//   wait(N)   → Sk.yield + _wakeAt   → rAF loop checks deadline, resumes when due
//   glide/ask → Sk.promise            → only case that still uses a real Promise
//
// No setTimeout anywhere in the timing path.

const PythonAPI = (() => {

  function buildModule(spriteId, threadId) {
    const getSp  = () => Engine.getSprite(spriteId);
    const noneV  = Sk.builtin.none.none$;
    const num    = v => new Sk.builtin.float_(+v);
    const pyStr  = v => new Sk.builtin.str(String(v));
    const pyBool = v => v ? Sk.builtin.bool.true$ : Sk.builtin.bool.false$;
    const fn     = f => new Sk.builtin.func(f);

    // ── Suspension factories ──────────────────────────────────────
    // Frame-yield: resume on the very next rAF tick.
    function yieldSusp() {
      const s  = new Sk.misceval.Suspension();
      s.resume = () => noneV;
      s.data   = { type: 'Sk.yield' };
      return s;
    }

    // Timed wait: resume when performance.now() >= deadline.
    // Still uses Sk.yield so it goes into _suspension; the rAF loop
    // checks _wakeAt before resuming instead of resuming every frame.
    function timedSusp(seconds) {
      const s    = new Sk.misceval.Suspension();
      s.resume   = () => noneV;
      s.data     = { type: 'Sk.yield' };
      s._wakeAt  = performance.now() + seconds * 1000;
      return s;
    }

    // Promise suspension — only for glide_to (rAF-driven internally) and ask().
    function promiseSusp(promise, resumeFn) {
      const s  = new Sk.misceval.Suspension();
      s.resume = resumeFn || (() => noneV);
      s.data   = { type: 'Sk.promise', promise };
      return s;
    }

    const api = {

      // ── Movement ─────────────────────────────────────────────
      move_steps: fn(steps => {
        const sp = getSp(); if (!sp) return noneV;
        const n  = +Sk.ffi.remapToJs(steps);
        const r  = Utils.degToRad(sp.direction);
        sp.x += Math.sin(r) * n;
        sp.y += Math.cos(r) * n;
        return noneV;
      }),

      turn: fn(deg => {
        const sp = getSp(); if (!sp) return noneV;
        sp.direction = ((sp.direction + +Sk.ffi.remapToJs(deg)) % 360 + 360) % 360;
        return noneV;
      }),

      go_to: fn((xOrStr, y) => {
        const sp = getSp(); if (!sp) return noneV;
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
        return noneV;
      }),

      glide_to: fn((xOrStr, yOrSecs, secs) => {
        const sp = getSp(); if (!sp) return yieldSusp();
        let tx, ty, dur;
        if (secs === undefined) {
          const t = Sk.ffi.remapToJs(xOrStr);
          dur = +Sk.ffi.remapToJs(yOrSecs);
          tx  = t === 'random' ? Math.random()*480-240 : Renderer.mouseX;
          ty  = t === 'random' ? Math.random()*360-180 : Renderer.mouseY;
        } else {
          tx = +Sk.ffi.remapToJs(xOrStr);
          ty = +Sk.ffi.remapToJs(yOrSecs);
          dur = +Sk.ffi.remapToJs(secs);
        }
        const sx = sp.x, sy = sp.y, start = performance.now();
        // glide uses rAF internally — promise resolves when animation done
        return promiseSusp(new Promise(resolve => {
          function tick() {
            const t = Math.min(1, (performance.now() - start) / (dur * 1000));
            sp.x = Utils.lerp(sx, tx, t);
            sp.y = Utils.lerp(sy, ty, t);
            if (t < 1) requestAnimationFrame(tick); else resolve();
          }
          requestAnimationFrame(tick);
        }));
      }),

      point_towards: fn(target => {
        const sp = getSp(); if (!sp) return noneV;
        const t  = Sk.ffi.remapToJs(target);
        let tx, ty;
        if (t === 'mouse_pointer' || t === 'mouse') {
          tx = Renderer.mouseX; ty = Renderer.mouseY;
        } else {
          const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
          if (!ts) return noneV;
          tx = ts.x; ty = ts.y;
        }
        sp.direction = (Utils.radToDeg(Math.atan2(tx - sp.x, ty - sp.y)) + 360) % 360;
        return noneV;
      }),

      change_x:      fn(v  => { const sp=getSp(); if(sp) sp.x += +Sk.ffi.remapToJs(v); return noneV; }),
      change_y:      fn(v  => { const sp=getSp(); if(sp) sp.y += +Sk.ffi.remapToJs(v); return noneV; }),
      set_x:         fn(v  => { const sp=getSp(); if(sp) sp.x  = +Sk.ffi.remapToJs(v); return noneV; }),
      set_y:         fn(v  => { const sp=getSp(); if(sp) sp.y  = +Sk.ffi.remapToJs(v); return noneV; }),
      get_x:         fn(() => { const sp=getSp(); return num(sp ? sp.x : 0); }),
      get_y:         fn(() => { const sp=getSp(); return num(sp ? sp.y : 0); }),
      get_direction: fn(() => { const sp=getSp(); return num(sp ? sp.direction : 90); }),

      // ── Edge & bounce ─────────────────────────────────────────
      on_edge: fn(() => {
        const sp = getSp();
        return pyBool(sp ? Renderer.spriteOnEdge(sp) : false);
      }),
      bounce: fn(() => {
        const sp = getSp(); if (sp) Renderer.bounceOffEdge(sp); return noneV;
      }),

      // ── Looks ─────────────────────────────────────────────────
      say: fn((msg, secs) => {
        const sp = getSp(); if (!sp) return noneV;
        sp._sayText = String(Sk.ffi.remapToJs(msg));
        if (sp._sayTimer) { clearTimeout(sp._sayTimer); sp._sayTimer = null; }
        if (secs !== undefined) {
          const dur = +Sk.ffi.remapToJs(secs);
          if (dur > 0) {
            // say(msg, secs) should block the thread for `dur` seconds
            sp._sayTimer = null; // cleared by timedSusp wakeup — see scheduler
            // We'll clear the bubble when the timed suspension resumes
            const s = timedSusp(dur);
            s._onResume = () => { sp._sayText = null; };
            return s;
          }
        }
        return noneV;
      }),

      set_costume: fn(name => {
        const sp = getSp(); if (!sp) return noneV;
        const n  = String(Sk.ffi.remapToJs(name));
        const i  = sp.costumes.findIndex(c => c.name === n);
        if (i >= 0) {
          sp.currentCostume = i;
          Renderer.loadSpriteImage(sp).then(() => {
            UI.renderSpritePanel();
            if (Engine.getSelectedSprite() === sp) CostumePanel.load(sp);
          });
        }
        return noneV;
      }),

      next_costume: fn(() => {
        const sp = getSp(); if (!sp || sp.costumes.length <= 1) return noneV;
        sp.currentCostume = (sp.currentCostume + 1) % sp.costumes.length;
        Renderer.loadSpriteImage(sp).then(() => {
          UI.renderSpritePanel();
          if (Engine.getSelectedSprite() === sp) CostumePanel.load(sp);
        });
        return noneV;
      }),

      set_stage: fn(name => {
        const stage = Engine.state.stage;
        const n     = String(Sk.ffi.remapToJs(name));
        const i     = stage.costumes.findIndex(c => c.name === n);
        if (i >= 0) {
          stage.currentCostume = i;
          Renderer.loadSpriteImage(stage).then(() => {
            UI.renderSpritePanel();
            Scheduler.fireEvent('stage_loaded', 'all', n);
          });
        }
        return noneV;
      }),

      next_stage: fn(() => {
        const stage = Engine.state.stage;
        if (stage.costumes.length > 1) {
          stage.currentCostume = (stage.currentCostume + 1) % stage.costumes.length;
          Renderer.loadSpriteImage(stage).then(() => UI.renderSpritePanel());
        }
        return noneV;
      }),

      set_size:    fn(v => { const sp=getSp(); if(sp) sp.size  = +Sk.ffi.remapToJs(v); return noneV; }),
      change_size: fn(v => { const sp=getSp(); if(sp) sp.size += +Sk.ffi.remapToJs(v); return noneV; }),
      show: fn(() => { const sp=getSp(); if(sp) sp.visible=true;  return noneV; }),
      hide: fn(() => { const sp=getSp(); if(sp) sp.visible=false; return noneV; }),

      // ── Control ───────────────────────────────────────────────
      // wait(0)  → frame-yield (resume next rAF)
      // wait(N)  → timed yield (resume after N seconds, checked in rAF loop)
      wait: fn(secs => {
        const s = +Sk.ffi.remapToJs(secs);
        return s <= 0 ? yieldSusp() : timedSusp(s);
      }),

      stop: fn(() => { Scheduler.stopAll(); return noneV; }),

      stop_this_thread: fn(() => {
        Scheduler.stopThread(spriteId, threadId);
        throw new Sk.builtin.SystemExit('stop_thread');
      }),

      // ── Events ────────────────────────────────────────────────
      broadcast: fn(evtName => {
        Scheduler.fireEvent('broadcast', 'all', String(Sk.ffi.remapToJs(evtName)));
        return noneV;
      }),

      broadcast_and_wait: fn(evtName => {
        const evt = String(Sk.ffi.remapToJs(evtName));
        return promiseSusp(Scheduler.fireEventAndWait('broadcast', 'all', evt));
      }),

      // ── Sensing ───────────────────────────────────────────────
      touching: fn(target => {
        const sp = getSp(); if (!sp) return pyBool(false);
        const t  = String(Sk.ffi.remapToJs(target));
        if (t === 'edge' || t === 'the edge') return pyBool(Renderer.spriteOnEdge(sp));
        if (t === 'mouse_pointer' || t === 'mouse')
          return pyBool(Renderer.isPointInSprite(sp, Renderer.mouseX, Renderer.mouseY));
        const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
        return pyBool(ts ? Renderer.spritesTouching(sp, ts) : false);
      }),

      touching_color: fn(hex => {
        const sp = getSp(); if (!sp || !sp._img) return pyBool(false);
        try {
          const [tr,tg,tb] = Utils.hexToRgb(String(Sk.ffi.remapToJs(hex)));
          const cv = document.getElementById('stage-canvas');
          const c  = cv.getContext('2d', { willReadFrequently: true });
          const hw = (sp._img.naturalWidth  * sp.size/100) / 2;
          const hh = (sp._img.naturalHeight * sp.size/100) / 2;
          const cx = sp.x + Renderer.STAGE_W/2;
          const cy = Renderer.STAGE_H/2 - sp.y;
          for (let i=0; i<=8; i++) {
            const frac = i/8;
            const pts = [
              [cx-hw+hw*2*frac, cy-hh], [cx-hw+hw*2*frac, cy+hh],
              [cx-hw, cy-hh+hh*2*frac], [cx+hw, cy-hh+hh*2*frac],
            ];
            for (const [px,py] of pts) {
              const d = c.getImageData(Math.round(px), Math.round(py), 1, 1).data;
              if (d[3]>10 && Math.abs(d[0]-tr)<30 && Math.abs(d[1]-tg)<30 && Math.abs(d[2]-tb)<30)
                return pyBool(true);
            }
          }
        } catch(e) {}
        return pyBool(false);
      }),

      distance_to: fn(target => {
        const sp = getSp(); if (!sp) return num(0);
        const t  = String(Sk.ffi.remapToJs(target));
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
        const sp   = getSp();
        const name = sp ? sp.name : 'PyScratch';
        return promiseSusp(
          InputSystem.showAsk(name, String(Sk.ffi.remapToJs(msg))),
          v => pyStr(v)
        );
      }),

      key_pressed: fn(key => pyBool(InputSystem.isKeyDown(String(Sk.ffi.remapToJs(key))))),
      mouse_x:     fn(() => num(Renderer.mouseX)),
      mouse_y:     fn(() => num(Renderer.mouseY)),
      mouse_down:  fn(() => pyBool(Renderer.mouseDown)),

      // ── Variables ─────────────────────────────────────────────
      set_var: fn((name, value) => {
        Engine.setGlobal(String(Sk.ffi.remapToJs(name)), Sk.ffi.remapToJs(value));
        return noneV;
      }),
      get_var: fn(name => {
        const v = Engine.getGlobal(String(Sk.ffi.remapToJs(name)));
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),
      set_sprite_var: fn((name, value) => {
        Engine.setSpriteVar(spriteId, String(Sk.ffi.remapToJs(name)), Sk.ffi.remapToJs(value));
        return noneV;
      }),
      get_sprite_var: fn(name => {
        const v = Engine.getSpriteVar(spriteId, String(Sk.ffi.remapToJs(name)));
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),
      display_variable: fn((name, visible) => {
        Engine.displayVariable(String(Sk.ffi.remapToJs(name)), Sk.ffi.remapToJs(visible), spriteId);
        return noneV;
      }),

      // ── Clones ────────────────────────────────────────────────
      create_clone: fn(() => {
        const sp = getSp(); if (!sp) return noneV;
        const clone = Engine.createSprite({
          ...sp,
          id: Utils.uid(), isClone: true, cloneOf: sp.id,
          threads:   sp.threads.map(t  => ({...t})),
          variables: {...sp.variables},
          costumes:  sp.costumes.map(c => ({...c})),
        });
        clone._img = sp._img; clone._emoji = sp._emoji;
        Engine.state.sprites.push(clone);
        Scheduler.startSpriteThreads(clone, 'clone_start');
        return noneV;
      }),

      delete_clone: fn(() => {
        const sp = getSp();
        if (sp && sp.isClone) { Scheduler.stopSpriteThreads(sp.id); Engine.deleteSprite(sp.id); }
        return noneV;
      }),

      // ── Layering ──────────────────────────────────────────────
      go_to_front:    fn(()  => { Engine.moveToFront(spriteId); return noneV; }),
      go_back_layers: fn(n   => { Engine.moveBackLayers(spriteId, +Sk.ffi.remapToJs(n)); return noneV; }),

      // ── Sound ─────────────────────────────────────────────────
      play_sound:      fn(name => { SoundSystem.play(String(Sk.ffi.remapToJs(name))); return noneV; }),
      stop_all_sounds: fn(()   => { SoundSystem.stopAll(); return noneV; }),
      set_volume:      fn(v    => { SoundSystem.setVolume(+Sk.ffi.remapToJs(v)); return noneV; }),

      // ── Lists ─────────────────────────────────────────────────
      list_create: fn(name    => { Engine.listCreate(String(Sk.ffi.remapToJs(name))); return noneV; }),
      list_add:    fn((n,v)   => { Engine.listAdd(String(Sk.ffi.remapToJs(n)), Sk.ffi.remapToJs(v)); return noneV; }),
      list_remove: fn((n,i)   => { Engine.listRemove(String(Sk.ffi.remapToJs(n)), +Sk.ffi.remapToJs(i)); return noneV; }),
      list_get:    fn((n,i)   => {
        const v = Engine.listGet(String(Sk.ffi.remapToJs(n)), +Sk.ffi.remapToJs(i));
        if (v === undefined) return noneV;
        return typeof v === 'number' ? num(v) : pyStr(v);
      }),

      // ── Math / timer ──────────────────────────────────────────
      random: fn((a,b) => {
        const lo=+Sk.ffi.remapToJs(a), hi=+Sk.ffi.remapToJs(b);
        return num(Math.random()*(hi-lo)+lo);
      }),
      random_int: fn((a,b) => {
        const lo=+Sk.ffi.remapToJs(a), hi=+Sk.ffi.remapToJs(b);
        return new Sk.builtin.int_(Math.floor(Math.random()*(hi-lo+1))+lo);
      }),
      timer:       fn(() => num((performance.now() - Scheduler.startTime) / 1000)),
      reset_timer: fn(() => { Scheduler.startTime = performance.now(); return noneV; }),
    };

    return api;
  }

  return { buildModule };
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
