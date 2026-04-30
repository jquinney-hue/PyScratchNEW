// python-api.js — Skulpt Python→JS bindings

const PythonAPI = (() => {

  // Build the Skulpt builtins module for a given sprite context
  function buildModule(spriteId, threadId) {
    const getSprite = () => Engine.getSprite(spriteId);

    const suspend = (seconds) => {
      const susp = new Sk.misceval.Suspension();
      susp.resume = () => Sk.builtin.none.none$;
      susp.data = {
        type: 'Sk.promise',
        promise: new Promise(resolve => setTimeout(resolve, seconds * 1000))
      };
      return susp;
    };

    const noneVal = Sk.builtin.none.none$;
    const pyTrue = Sk.builtin.bool.true$;
    const pyFalse = Sk.builtin.bool.false$;
    const num = (v) => new Sk.builtin.float_(Number(v));
    const pyStr = (v) => new Sk.builtin.str(String(v));
    const pyBool = (v) => v ? pyTrue : pyFalse;

    function fn(name, f, minArgs, maxArgs) {
      const func = new Sk.builtin.func(f);
      func.tp$name = name;
      return func;
    }

    const mod = {
      // ── Movement ──────────────────────────────────────────────
      move_steps: fn('move_steps', (steps) => {
        const sp = getSprite();
        if (!sp) return noneVal;
        const n = Sk.ffi.remapToJs(steps);
        const rad = Utils.scratchDirToRad(sp.direction);
        sp.x += Math.cos(rad) * n;
        sp.y += -Math.sin(rad) * n; // y inverted in canvas
        // Wait for sprite y: scratch +y = up, canvas +y = down
        sp.x = Utils.clamp(sp.x, -240, 240);
        sp.y = Utils.clamp(sp.y, -180, 180);
        return noneVal;
      }),

      turn: fn('turn', (degrees) => {
        const sp = getSprite();
        if (sp) {
          sp.direction = ((sp.direction + Sk.ffi.remapToJs(degrees)) % 360 + 360) % 360;
        }
        return noneVal;
      }),

      go_to: fn('go_to', (x, y) => {
        const sp = getSprite();
        if (!sp) return noneVal;
        if (y === undefined) {
          // go_to("random") or go_to("mouse")
          const target = Sk.ffi.remapToJs(x);
          if (target === 'random') {
            sp.x = Math.round(Math.random() * 480 - 240);
            sp.y = Math.round(Math.random() * 360 - 180);
          } else if (target === 'mouse') {
            sp.x = Renderer.mouseX;
            sp.y = Renderer.mouseY;
          }
        } else {
          sp.x = Sk.ffi.remapToJs(x);
          sp.y = Sk.ffi.remapToJs(y);
        }
        return noneVal;
      }),

      glide_to: fn('glide_to', (x, y, seconds) => {
        const sp = getSprite();
        if (!sp) return suspend(0);
        const tx = Sk.ffi.remapToJs(x);
        const ty = Sk.ffi.remapToJs(y);
        const dur = Sk.ffi.remapToJs(seconds) * 1000;
        const sx = sp.x, sy = sp.y;
        const start = Date.now();
        const susp = new Sk.misceval.Suspension();
        susp.data = {
          type: 'Sk.promise',
          promise: new Promise(resolve => {
            const tick = () => {
              const t = Math.min(1, (Date.now() - start) / dur);
              sp.x = Utils.lerp(sx, tx, t);
              sp.y = Utils.lerp(sy, ty, t);
              if (t < 1) requestAnimationFrame(tick);
              else resolve();
            };
            tick();
          })
        };
        susp.resume = () => noneVal;
        return susp;
      }),

      point_towards: fn('point_towards', (target) => {
        const sp = getSprite();
        if (!sp) return noneVal;
        const t = Sk.ffi.remapToJs(target);
        let tx, ty;
        if (t === 'mouse') {
          tx = Renderer.mouseX; ty = Renderer.mouseY;
        } else {
          const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
          if (!ts) return noneVal;
          tx = ts.x; ty = ts.y;
        }
        const dx = tx - sp.x, dy = ty - sp.y;
        sp.direction = (Utils.radToDeg(Math.atan2(dy, dx)) + 360) % 360;
        return noneVal;
      }),

      change_x: fn('change_x', (v) => { const sp = getSprite(); if (sp) sp.x += Sk.ffi.remapToJs(v); return noneVal; }),
      change_y: fn('change_y', (v) => { const sp = getSprite(); if (sp) sp.y += Sk.ffi.remapToJs(v); return noneVal; }),
      set_x: fn('set_x', (v) => { const sp = getSprite(); if (sp) sp.x = Sk.ffi.remapToJs(v); return noneVal; }),
      set_y: fn('set_y', (v) => { const sp = getSprite(); if (sp) sp.y = Sk.ffi.remapToJs(v); return noneVal; }),
      get_x: fn('get_x', () => { const sp = getSprite(); return num(sp ? sp.x : 0); }),
      get_y: fn('get_y', () => { const sp = getSprite(); return num(sp ? sp.y : 0); }),
      get_direction: fn('get_direction', () => { const sp = getSprite(); return num(sp ? sp.direction : 90); }),

      // ── Edge ──────────────────────────────────────────────────
      on_edge: fn('on_edge', () => pyBool(Renderer.spriteOnEdge(getSprite() || {}))),
      bounce: fn('bounce', () => { const sp = getSprite(); if (sp) Renderer.bounceOffEdge(sp); return noneVal; }),

      // ── Looks ─────────────────────────────────────────────────
      say: fn('say', (msg, secs) => {
        const sp = getSprite();
        if (!sp) return noneVal;
        const text = Sk.ffi.remapToJs(msg);
        const dur = secs ? Sk.ffi.remapToJs(secs) : 0;
        sp._sayText = text;
        if (sp._sayTimer) clearTimeout(sp._sayTimer);
        if (dur > 0) {
          sp._sayTimer = setTimeout(() => { sp._sayText = null; }, dur * 1000);
          return suspend(dur);
        }
        return noneVal;
      }),

      set_costume: fn('set_costume', (name) => {
        const sp = getSprite();
        if (!sp) return noneVal;
        const n = Sk.ffi.remapToJs(name);
        const idx = sp.costumes.findIndex(c => c.name === n || String(c.name) === String(n));
        if (idx >= 0) {
          sp.currentCostume = idx;
          Renderer.loadSpriteImage(sp);
        }
        return noneVal;
      }),

      next_costume: fn('next_costume', () => {
        const sp = getSprite();
        if (sp && sp.costumes.length > 1) {
          sp.currentCostume = (sp.currentCostume + 1) % sp.costumes.length;
          Renderer.loadSpriteImage(sp);
        }
        return noneVal;
      }),

      set_stage: fn('set_stage', (name) => {
        const stage = Engine.state.stage;
        const n = Sk.ffi.remapToJs(name);
        const idx = stage.costumes.findIndex(c => c.name === n);
        if (idx >= 0) {
          stage.currentCostume = idx;
          Renderer.loadSpriteImage(stage);
          Scheduler.fireEvent('stage_loaded', 'all', n);
        }
        return noneVal;
      }),

      next_stage: fn('next_stage', () => {
        const stage = Engine.state.stage;
        if (stage.costumes.length > 1) {
          stage.currentCostume = (stage.currentCostume + 1) % stage.costumes.length;
          Renderer.loadSpriteImage(stage);
        }
        return noneVal;
      }),

      set_size: fn('set_size', (v) => { const sp = getSprite(); if (sp) sp.size = Sk.ffi.remapToJs(v); return noneVal; }),
      change_size: fn('change_size', (v) => { const sp = getSprite(); if (sp) sp.size += Sk.ffi.remapToJs(v); return noneVal; }),
      show: fn('show', () => { const sp = getSprite(); if (sp) sp.visible = true; return noneVal; }),
      hide: fn('hide', () => { const sp = getSprite(); if (sp) sp.visible = false; return noneVal; }),

      // ── Control ───────────────────────────────────────────────
      wait: fn('wait', (secs) => suspend(Sk.ffi.remapToJs(secs))),

      stop: fn('stop', () => {
        Scheduler.stopAll();
        return noneVal;
      }),

      stop_this_thread: fn('stop_this_thread', () => {
        Scheduler.stopThread(spriteId, threadId);
        throw new Sk.builtin.SystemExit('stop_thread');
      }),

      // ── Sensing ───────────────────────────────────────────────
      touching: fn('touching', (target) => {
        const sp = getSprite();
        if (!sp) return pyFalse;
        const t = Sk.ffi.remapToJs(target);
        if (t === 'edge') return pyBool(Renderer.spriteOnEdge(sp));
        const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
        return pyBool(ts ? Renderer.spritesTouching(sp, ts) : false);
      }),

      distance_to: fn('distance_to', (target) => {
        const sp = getSprite();
        if (!sp) return num(0);
        const t = Sk.ffi.remapToJs(target);
        let tx, ty;
        if (t === 'mouse') { tx = Renderer.mouseX; ty = Renderer.mouseY; }
        else {
          const ts = Engine.getAllSprites().find(s => s.name === t || s.id === t);
          if (!ts) return num(0);
          tx = ts.x; ty = ts.y;
        }
        return num(Utils.dist(sp.x, sp.y, tx, ty));
      }),

      key_pressed: fn('key_pressed', (key) => {
        const k = Sk.ffi.remapToJs(key);
        return pyBool(InputSystem.isKeyDown(k));
      }),

      mouse_x: fn('mouse_x', () => num(Renderer.mouseX)),
      mouse_y: fn('mouse_y', () => num(Renderer.mouseY)),
      mouse_down: fn('mouse_down', () => pyBool(Renderer.mouseDown)),

      ask: fn('ask', (msg) => {
        const message = Sk.ffi.remapToJs(msg);
        const susp = new Sk.misceval.Suspension();
        susp.data = {
          type: 'Sk.promise',
          promise: InputSystem.showAsk(message)
        };
        susp.resume = (v) => pyStr(v);
        return susp;
      }),

      // ── Broadcast ─────────────────────────────────────────────
      broadcast: fn('broadcast', (eventName) => {
        Scheduler.fireEvent('broadcast', 'all', Sk.ffi.remapToJs(eventName));
        return noneVal;
      }),

      broadcast_and_wait: fn('broadcast_and_wait', (eventName) => {
        const evt = Sk.ffi.remapToJs(eventName);
        const susp = new Sk.misceval.Suspension();
        susp.data = {
          type: 'Sk.promise',
          promise: Scheduler.fireEventAndWait('broadcast', 'all', evt)
        };
        susp.resume = () => noneVal;
        return susp;
      }),

      // ── Clones ────────────────────────────────────────────────
      create_clone: fn('create_clone', () => {
        const sp = getSprite();
        if (!sp) return noneVal;
        const clone = Engine.createSprite({
          ...Utils.deepClone(sp),
          id: Utils.uid(),
          isClone: true,
          cloneOf: sp.id,
          threads: Utils.deepClone(sp.threads),
          variables: Utils.deepClone(sp.variables),
        });
        clone._img = sp._img;
        clone._emoji = sp._emoji;
        Engine.state.sprites.push(clone);
        Scheduler.startSpriteThreads(clone, 'clone_start');
        return noneVal;
      }),

      delete_clone: fn('delete_clone', () => {
        const sp = getSprite();
        if (sp && sp.isClone) {
          Scheduler.stopSpriteThreads(sp.id);
          Engine.deleteSprite(sp.id);
        }
        return noneVal;
      }),

      // ── Variables ─────────────────────────────────────────────
      set_var: fn('set_var', (name, value) => {
        const n = Sk.ffi.remapToJs(name);
        const v = Sk.ffi.remapToJs(value);
        Engine.setGlobal(n, v);
        return noneVal;
      }),

      get_var: fn('get_var', (name) => {
        const v = Engine.getGlobal(Sk.ffi.remapToJs(name));
        if (typeof v === 'number') return num(v);
        return pyStr(v);
      }),

      set_sprite_var: fn('set_sprite_var', (name, value) => {
        Engine.setSpriteVar(spriteId, Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(value));
        return noneVal;
      }),

      get_sprite_var: fn('get_sprite_var', (name) => {
        const v = Engine.getSpriteVar(spriteId, Sk.ffi.remapToJs(name));
        if (typeof v === 'number') return num(v);
        return pyStr(v);
      }),

      display_variable: fn('display_variable', (name, visible) => {
        Engine.displayVariable(
          Sk.ffi.remapToJs(name),
          Sk.ffi.remapToJs(visible),
          spriteId
        );
        return noneVal;
      }),

      // ── Lists ─────────────────────────────────────────────────
      list_create: fn('list_create', (name) => { Engine.listCreate(Sk.ffi.remapToJs(name)); return noneVal; }),
      list_add: fn('list_add', (name, value) => { Engine.listAdd(Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(value)); return noneVal; }),
      list_remove: fn('list_remove', (name, idx) => { Engine.listRemove(Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(idx)); return noneVal; }),
      list_get: fn('list_get', (name, idx) => {
        const v = Engine.listGet(Sk.ffi.remapToJs(name), Sk.ffi.remapToJs(idx));
        if (v === undefined) return noneVal;
        if (typeof v === 'number') return num(v);
        return pyStr(v);
      }),

      // ── Layering ──────────────────────────────────────────────
      go_to_front: fn('go_to_front', () => { Engine.moveToFront(spriteId); return noneVal; }),
      go_back_layers: fn('go_back_layers', (n) => { Engine.moveBackLayers(spriteId, Sk.ffi.remapToJs(n)); return noneVal; }),

      // ── Sound ─────────────────────────────────────────────────
      play_sound: fn('play_sound', (name) => {
        // Basic audio support
        SoundSystem.play(Sk.ffi.remapToJs(name));
        return noneVal;
      }),

      stop_all_sounds: fn('stop_all_sounds', () => { SoundSystem.stopAll(); return noneVal; }),
      set_volume: fn('set_volume', (v) => { SoundSystem.setVolume(Sk.ffi.remapToJs(v)); return noneVal; }),

      // ── Math helpers ──────────────────────────────────────────
      random: fn('random', (a, b) => {
        const min = Sk.ffi.remapToJs(a), max = Sk.ffi.remapToJs(b);
        return num(Math.random() * (max - min) + min);
      }),

      random_int: fn('random_int', (a, b) => {
        const min = Sk.ffi.remapToJs(a), max = Sk.ffi.remapToJs(b);
        return new Sk.builtin.int_(Math.floor(Math.random() * (max - min + 1)) + min);
      }),

      // ── Timer ─────────────────────────────────────────────────
      timer: fn('timer', () => num((Date.now() - Scheduler.startTime) / 1000)),
      reset_timer: fn('reset_timer', () => { Scheduler.startTime = Date.now(); return noneVal; }),
    };

    return mod;
  }

  // Configure Skulpt
  function configure() {
    Sk.configure({
      output: (text) => console.log('[PyScratch]', text),
      read: (x) => {
        if (Sk.builtinFiles === undefined || Sk.builtinFiles.files[x] === undefined)
          throw "File not found: '" + x + "'";
        return Sk.builtinFiles.files[x];
      },
      execLimit: 50000, // instructions per call
      __future__: Sk.python3,
    });
  }

  // Run Python code for a sprite/thread
  async function runCode(code, spriteId, threadId) {
    configure();

    const apiMod = buildModule(spriteId, threadId);

    // Inject all API functions as globals
    const injectCode = Object.entries(apiMod)
      .map(([k]) => `from _pyscratch import ${k}`)
      .join('\n');

    const fullCode = `${code}`;

    // Add import handler
    Sk.builtins = {};
    const originalImport = Sk.importSetUpPath;

    try {
      // Create the pyscratch module
      const mod = new Sk.builtin.module();
      mod.$d = {};
      for (const [k, v] of Object.entries(apiMod)) {
        mod.$d[k] = v;
      }

      Sk.sysmodules.mp$ass_subscript(
        new Sk.builtin.str('_pyscratch'),
        mod
      );

      // Inject functions directly into builtins
      for (const [k, v] of Object.entries(apiMod)) {
        Sk.builtins[k] = v;
      }

      await Sk.misceval.asyncToPromise(() =>
        Sk.importMainWithBody('<main>', false, fullCode, true)
      );

    } catch (err) {
      if (err instanceof Sk.builtin.SystemExit) return; // stop_this_thread
      const msg = err.toString ? err.toString() : String(err);
      if (msg.includes('stop_thread')) return;
      throw err;
    }
  }

  return { buildModule, runCode, configure };
})();

// ── Sound System ─────────────────────────────────────────────────
const SoundSystem = (() => {
  const sounds = {};
  let volume = 1;

  function play(name) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(volume * 0.1, ctx.currentTime);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  return {
    play,
    stopAll: () => {},
    setVolume: (v) => { volume = Utils.clamp(v / 100, 0, 1); }
  };
})();

// ── Input System ──────────────────────────────────────────────────
const InputSystem = (() => {
  const keys = new Set();

  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    keys.add(e.code.toLowerCase());
    Scheduler.fireEvent('keypress', 'all', e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
    keys.delete(e.code.toLowerCase());
  });

  function isKeyDown(key) {
    return keys.has(key.toLowerCase()) || keys.has(('key' + key).toLowerCase());
  }

  function showAsk(message) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('ask-overlay');
      const msgEl = document.getElementById('ask-message');
      const input = document.getElementById('ask-input');
      const submit = document.getElementById('ask-submit');

      msgEl.textContent = message;
      input.value = '';
      overlay.classList.remove('hidden');
      input.focus();

      const done = () => {
        overlay.classList.add('hidden');
        resolve(input.value);
      };

      submit.onclick = done;
      input.onkeydown = (e) => { if (e.key === 'Enter') done(); };
    });
  }

  return { isKeyDown, showAsk };
})();
