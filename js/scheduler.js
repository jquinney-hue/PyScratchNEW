// scheduler.js — cooperative thread scheduler
//
// TIMING MODEL:
//   All threads are driven exclusively by requestAnimationFrame.
//   No setTimeout anywhere in the execution path.
//
//   wait(0)  → Sk.yield suspension, resumes next rAF frame (1 tick)
//   wait(N)  → Sk.yield suspension with _wakeAt timestamp;
//              rAF loop only resumes when performance.now() >= _wakeAt
//   say(msg, N) → same as wait(N) but clears the bubble on resume
//   glide/ask → Sk.promise (internally rAF-driven or user-driven)
//
//   The yieldLimit on Skulpt ensures that even code with NO wait() at all
//   still suspends every 1000 bytecode ops so the loop can tick.
//   The injected wait(0) at the bottom of every while loop guarantees
//   exactly one suspension per loop iteration = frame-locked 60fps.

const Scheduler = (() => {
  let activeThreads = [];
  let animFrameId   = null;
  let startTime     = performance.now();
  let _runId        = 0;

  // ── Performance log ───────────────────────────────────────────
  const PERF_HISTORY = 120; // keep last 120 frames (~2s at 60fps)
  const _perf = {
    frameTimes:  [],   // ms per frame (wall time between rAF calls)
    tickTimes:   [],   // ms spent ticking all threads each frame
    renderTimes: [],   // ms spent in Renderer.render()
    threadLog:   {},   // spriteId:threadId -> { ticks, totalMs, lastMs }
    lastFrameAt: 0,
    frameCount:  0,
  };

  function _perfRecord(frameDt, tickMs, renderMs) {
    const arr = _perf.frameTimes;
    arr.push(frameDt); if (arr.length > PERF_HISTORY) arr.shift();
    const arr2 = _perf.tickTimes;
    arr2.push(tickMs); if (arr2.length > PERF_HISTORY) arr2.shift();
    const arr3 = _perf.renderTimes;
    arr3.push(renderMs); if (arr3.length > PERF_HISTORY) arr3.shift();
    _perf.frameCount++;
    // Only push to panel every frame — panel itself skips render when hidden
    PerfPanel.update(_perf);
  }

  function _perfThreadTick(ts, ms) {
    const key = ts.spriteId + ':' + ts.threadId;
    if (!_perf.threadLog[key]) {
      _perf.threadLog[key] = { name: ts.name, spriteId: ts.spriteId, ticks: 0, totalMs: 0, lastMs: 0 };
    }
    const e = _perf.threadLog[key];
    e.ticks++;
    e.totalMs += ms;
    e.lastMs   = ms;
  }

  // ── Start / Stop ──────────────────────────────────────────────
  function startAll() {
    if (Engine.state.running) return;
    Engine.state.running = true;
    document.body.classList.add('running');
    startTime     = performance.now();
    activeThreads = [];
    _runId++;

    for (const sp of Engine.getAllSprites()) startSpriteThreads(sp, 'game_start');
    startSpriteThreads(Engine.state.stage, 'game_start');

    _scheduleLoop(_runId);
  }

  function stopAll() {
    Engine.state.running = false;
    document.body.classList.remove('running');
    _runId++;
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }

    for (const t of activeThreads) t.dead = true;
    activeThreads = [];

    // Remove all clones — they only exist at runtime
    Engine.state.sprites = Engine.state.sprites.filter(s => !s.isClone);

    // Clear say bubbles on all remaining sprites and stage
    for (const sp of [...Engine.getAllSprites(), Engine.state.stage]) {
      sp._sayText = null;
      if (sp._sayTimer) { clearTimeout(sp._sayTimer); sp._sayTimer = null; }
    }

    Renderer.markSortDirty();
    UI.renderSpritePanel();
    _updateThreadUI();
    Renderer.render();
  }

  // ── Thread management ─────────────────────────────────────────
  function startSpriteThreads(sprite, triggerEvent, extraArg) {
    for (const thread of (sprite.threads || [])) {
      if (!thread.code || !thread.code.trim()) continue;
      _launchThread(sprite, thread, triggerEvent, extraArg);
    }
  }

  function stopThread(spriteId, threadId) {
    for (const t of activeThreads) {
      if (t.spriteId === spriteId && t.threadId === threadId) t.dead = true;
    }
    activeThreads = activeThreads.filter(t => !(t.spriteId === spriteId && t.threadId === threadId));
    _updateThreadUI();
  }

  function stopSpriteThreads(spriteId) {
    for (const t of activeThreads) { if (t.spriteId === spriteId) t.dead = true; }
    activeThreads = activeThreads.filter(t => t.spriteId !== spriteId);
    _updateThreadUI();
  }

  // ── Events ────────────────────────────────────────────────────
  function fireEvent(type, target, extraArg) {
    if (!Engine.state.running) return;
    const sprites = target === 'all'
      ? [...Engine.getAllSprites(), Engine.state.stage]
      : [Engine.getSprite(target)].filter(Boolean);
    for (const sp of sprites) startSpriteThreads(sp, type, extraArg);
  }

  function fireEventAndWait(type, target, extraArg) {
    fireEvent(type, target, extraArg);
    // Resolve after two frames so spawned threads have a chance to start
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  // ── Inject wait(0) into every while loop body ─────────────────
  function _injectWhileWaits(code) {
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const whileMatch = lines[i].match(/^(\s*)while\b.+:\s*$/);
      if (!whileMatch) continue;

      const whileIndent = whileMatch[1].length;
      let bodyIndent = null;
      let lastBodyIdx = -1;

      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '' || line.trim().startsWith('#')) continue;
        const indent = line.match(/^(\s*)/)[1].length;
        if (bodyIndent === null) {
          if (indent <= whileIndent) break;
          bodyIndent = indent;
        }
        if (indent < bodyIndent) break;
        lastBodyIdx = j;
      }

      if (lastBodyIdx === -1 || bodyIndent === null) continue;

      const lastLine = lines[lastBodyIdx].trim();
      if (lastLine === 'wait(0)' || lastLine === 'wait(0.0)') continue;

      lines.splice(lastBodyIdx + 1, 0, ' '.repeat(bodyIndent) + 'wait(0)');
    }

    return lines.join('\n');
  }

  // ── Launch one thread ─────────────────────────────────────────
  function _launchThread(sprite, thread, triggerEvent, extraArg) {
    const entryCall = _buildEntryCall(thread.code, triggerEvent, extraArg);
    if (entryCall === null) return;

    const processedCode = _injectWhileWaits(thread.code);
    const fullCode      = processedCode + '\n' + entryCall;

    const ts = {
      id:          Utils.uid(),
      spriteId:    sprite.id,
      threadId:    thread.id,
      name:        thread.name,
      dead:        false,
      error:       null,
      _suspension: null, // parked Sk.yield suspension waiting for next tick
    };

    activeThreads.push(ts);
    _updateThreadUI();
    _runSkulptThread(fullCode, sprite.id, thread.id, ts);
  }

  function _buildEntryCall(code, event, extraArg) {
    const H = {
      game_start:   { re: /def\s+game_start\s*\(/,       call: 'game_start()' },
      clone_start:  { re: /def\s+on_clone_start\s*\(/,   call: 'on_clone_start()' },
      click:        { re: /def\s+on_click\s*\(/,          call: 'on_click()' },
      stage_click:  { re: /def\s+on_click\s*\(/,          call: 'on_click()' },
      keypress:     { re: /def\s+on_keypress\s*\(/,       call: `on_keypress(${JSON.stringify(extraArg||'')})` },
      broadcast:    { re: /def\s+on_broadcast\s*\(/,      call: `on_broadcast(${JSON.stringify(extraArg||'')})` },
      stage_loaded: { re: /def\s+on_stage_loaded\s*\(/,   call: `on_stage_loaded(${JSON.stringify(extraArg||'')})` },
    };
    const h = H[event];
    if (!h || !h.re.test(code)) return null;
    return h.call;
  }

  // ── Skulpt execution ──────────────────────────────────────────
  // ISOLATION STRATEGY:
  // Skulpt's builtins dict is global, but importMainWithBody is
  // synchronous up to its first suspension. We exploit this:
  //   1. Write this thread's API into Sk.builtins immediately before launch.
  //   2. The thread runs synchronously until it hits its first wait(0) /
  //      Sk.yield suspension and parks itself in ts._suspension.
  //   3. From that point on, the thread is resumed by _tick() one frame
  //      at a time — but by then ALL threads have already launched and
  //      each has its own closure captured in ts._api.
  //   4. On each resume we re-apply this thread's API to Sk.builtins for
  //      the duration of that tick, then the next thread does the same.
  //
  // Because Skulpt is single-threaded JS under the hood, only one thread
  // actually executes Python at any instant — so setting builtins before
  // each resume is safe and correct.
  function _runSkulptThread(code, spriteId, threadId, ts) {
    const { api, flatEntries } = PythonAPI.buildModule(spriteId, threadId);
    ts._flatEntries = flatEntries; // pre-built [k,v,k,v...] for fast apply

    // Apply this thread's API to builtins for the initial synchronous run
    _applyAPI(flatEntries);

    let susp;
    try {
      susp = Sk.importMainWithBody('<thread_' + ts.id + '>', false, code, true);
    } catch(e) {
      _threadError(ts, e);
      return;
    }

    _drive(susp, ts);
  }

  // Write a thread's API into Sk.builtins using pre-built flat array
  // [k0, v0, k1, v1, ...] — avoids Object.entries() allocation per frame
  function _applyAPI(flatEntries) {
    for (let i = 0; i < flatEntries.length; i += 2) {
      Sk.builtins[flatEntries[i]] = flatEntries[i + 1];
    }
  }

  // ── Drive the suspension chain ────────────────────────────────
  // Returns immediately. Resumes happen either from _tick() (rAF-driven)
  // or from a Promise.then() for glide/ask.
  function _drive(susp, ts) {
    while (true) {
      if (ts.dead) return;

      // Finished
      if (!(susp instanceof Sk.misceval.Suspension)) {
        _threadDone(ts); return;
      }

      const type = susp.data && susp.data.type;

      // ── Sk.yield — park until rAF tick (or wakeAt deadline) ──
      if (type === 'Sk.yield') {
        ts._suspension = susp;
        return;
      }

      // ── Sk.promise — glide_to, ask, broadcast_and_wait ────────
      if (type === 'Sk.promise') {
        susp.data.promise.then(value => {
          if (ts.dead) return;
          // Re-apply this thread's API before resuming from a promise
          if (ts._flatEntries) _applyAPI(ts._flatEntries);
          let next;
          try { next = susp.resume(value); }
          catch(e) { _threadError(ts, e); return; }
          _drive(next, ts);
        }).catch(e => _threadError(ts, e));
        return;
      }

      // Unknown — resume immediately and loop
      let next;
      try { next = susp.resume(); }
      catch(e) { _threadError(ts, e); return; }
      susp = next;
    }
  }

  // ── Tick one thread (called from rAF loop) ────────────────────
  function _tick(ts, now) {
    if (ts.dead || !ts._suspension) return;

    const susp = ts._suspension;

    // If this suspension has a wake deadline, don't resume yet
    if (susp._wakeAt && now < susp._wakeAt) return;

    // Fire any resume side-effect (e.g. say() clears bubble)
    if (susp._onResume) { susp._onResume(); susp._onResume = null; }

    ts._suspension = null;

    // Re-apply THIS thread's API to Sk.builtins before resuming.
    // Only one thread executes at a time (JS is single-threaded), so
    // this is safe — builtins point at the right sprite for this tick.
    if (ts._flatEntries) _applyAPI(ts._flatEntries);

    let next;
    try { next = susp.resume(); }
    catch(e) { _threadError(ts, e); return; }
    _drive(next, ts);
  }

  // ── Main rAF loop ─────────────────────────────────────────────
  // No dt throttle — rAF already gives us exactly one call per display
  // refresh. Throttling on top causes irregular ticks on high-Hz monitors.
  function _scheduleLoop(runId) {
    function frame(now) {
      if (_runId !== runId || !Engine.state.running) return;
      animFrameId = requestAnimationFrame(frame);

      const frameDt = _perf.lastFrameAt ? now - _perf.lastFrameAt : 0;
      _perf.lastFrameAt = now;

      // Tick every parked thread
      // Use activeThreads directly (no .slice()) — threads only removed via
      // _threadDone/_threadError which filter the array; new threads appended
      // at end are fine to run this frame too.
      const tickStart = performance.now();
      for (let i = 0; i < activeThreads.length; i++) {
        const t  = activeThreads[i];
        const t0 = performance.now();
        _tick(t, now);
        _perfThreadTick(t, performance.now() - t0);
      }
      const tickMs = performance.now() - tickStart;

      const renderStart = performance.now();
      Renderer.render();
      const renderMs = performance.now() - renderStart;

      UI.updateVariableDisplay();
      _perfRecord(frameDt, tickMs, renderMs);
    }

    animFrameId = requestAnimationFrame(frame);
  }

  // ── Helpers ───────────────────────────────────────────────────
  function _threadDone(ts) {
    ts.dead = true;
    activeThreads = activeThreads.filter(t => t !== ts);
    _updateThreadUI();
  }

  function _threadError(ts, err) {
    if (ts.dead) return;
    ts.dead = true;
    const msg = err && err.toString ? err.toString() : String(err);
    if (msg.includes('stop_thread') || msg.includes('SystemExit')) {
      activeThreads = activeThreads.filter(t => t !== ts);
      _updateThreadUI();
      return;
    }
    ts.error = msg;
    activeThreads = activeThreads.filter(t => t !== ts);
    _updateThreadUI();
    _showError(ts.spriteId, ts.threadId, msg);
  }

  function _updateThreadUI() {
    const sel = Engine.getSelectedSprite();
    if (!sel) return;
    document.querySelectorAll('.thread-tab').forEach(el => {
      const tid = el.dataset.threadId;
      const alive = activeThreads.some(t => t.spriteId===sel.id && t.threadId===tid && !t.dead);
      el.classList.toggle('running', alive);
      el.classList.toggle('error', activeThreads.some(t => t.spriteId===sel.id && t.threadId===tid && !!t.error));
    });
  }

  function _showError(spriteId, threadId, msg) {
    const sel = Engine.getSelectedSprite();
    if (!sel || sel.id !== spriteId) return;
    const el = document.getElementById('error-overlay');
    if (!el) return;
    el.textContent = '⚠ ' + msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 10000);
  }

  return {
    startAll, stopAll,
    startSpriteThreads, stopThread, stopSpriteThreads,
    fireEvent, fireEventAndWait,
    updateThreadUI: _updateThreadUI,
    get startTime()    { return startTime; },
    set startTime(v)   { startTime = v; },
    get activeThreads(){ return activeThreads; },
    get perf()         { return _perf; },
  };
})();
