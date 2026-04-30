// scheduler.js — thread scheduling & event system

const Scheduler = (() => {
  // Active running threads: { spriteId, threadId, promise, reject }
  let activeThreads = [];
  let eventHandlers = {}; // 'event:target:data' -> [handler fn]
  let animFrameId = null;
  let startTime = Date.now();
  let lastFrameTime = 0;

  // ── Start / Stop ──────────────────────────────────────────────
  function startAll() {
    if (Engine.state.running) return;
    Engine.state.running = true;
    document.body.classList.add('running');
    startTime = Date.now();
    eventHandlers = {};
    activeThreads = [];

    // Start all sprite threads
    for (const sprite of Engine.getAllSprites()) {
      startSpriteThreads(sprite, 'game_start');
    }
    // Start stage threads
    startSpriteThreads(Engine.state.stage, 'game_start');

    // Start render loop
    scheduleFrame();
  }

  function stopAll() {
    Engine.state.running = false;
    document.body.classList.remove('running');

    // Cancel all threads
    for (const t of activeThreads) {
      if (t.abortCtrl) t.abortCtrl.abort();
    }
    activeThreads = [];
    eventHandlers = {};

    // Clear speech bubbles
    for (const sp of Engine.getAllSprites()) {
      sp._sayText = null;
      if (sp._sayTimer) clearTimeout(sp._sayTimer);
    }

    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    updateThreadUI();
    Renderer.render();
  }

  function startSpriteThreads(sprite, triggerEvent) {
    for (const thread of sprite.threads) {
      if (!thread.code || !thread.code.trim()) continue;

      // Check if this thread has a handler for the trigger
      const code = thread.code;
      const hasHandler = checkHasHandler(code, triggerEvent);
      if (hasHandler) {
        launchThread(sprite.id, thread, triggerEvent);
      }
    }
  }

  function checkHasHandler(code, event) {
    const map = {
      'game_start': /def\s+game_start\s*\(/,
      'clone_start': /def\s+on_clone_start\s*\(/,
    };
    if (map[event]) return map[event].test(code);
    return true; // For broadcast etc, always run
  }

  function launchThread(spriteId, thread, triggerEvent, extraArg) {
    const ctrl = new AbortController();
    const signal = ctrl.signal;

    const threadState = {
      spriteId,
      threadId: thread.id,
      name: thread.name,
      abortCtrl: ctrl,
      running: true,
      error: null
    };
    activeThreads.push(threadState);

    // Determine call code based on trigger
    let callCode = '';
    const code = thread.code;

    if (triggerEvent === 'game_start' && /def\s+game_start\s*\(/.test(code)) {
      callCode = '\ngame_start()';
    } else if (triggerEvent === 'clone_start' && /def\s+on_clone_start\s*\(/.test(code)) {
      callCode = '\non_clone_start()';
    } else if (triggerEvent === 'click' && /def\s+on_click\s*\(/.test(code)) {
      callCode = '\non_click()';
    } else if (triggerEvent === 'keypress' && /def\s+on_keypress\s*\(/.test(code)) {
      callCode = `\non_keypress(${JSON.stringify(extraArg || '')})`;
    } else if (triggerEvent === 'broadcast' && /def\s+on_broadcast\s*\(/.test(code)) {
      callCode = `\non_broadcast(${JSON.stringify(extraArg || '')})`;
    } else if (triggerEvent === 'stage_loaded' && /def\s+on_stage_loaded\s*\(/.test(code)) {
      callCode = `\non_stage_loaded(${JSON.stringify(extraArg || '')})`;
    } else {
      // Remove this thread from active if no matching handler
      activeThreads = activeThreads.filter(t => t !== threadState);
      return null;
    }

    const fullCode = code + callCode;
    updateThreadUI();

    PythonAPI.runCode(fullCode, spriteId, thread.id)
      .then(() => {
        threadState.running = false;
        activeThreads = activeThreads.filter(t => t !== threadState);
        updateThreadUI();
      })
      .catch((err) => {
        if (signal.aborted) return;
        threadState.running = false;
        threadState.error = err;
        activeThreads = activeThreads.filter(t => t !== threadState);
        updateThreadUI();
        showThreadError(spriteId, thread.id, err);
      });

    return threadState;
  }

  function stopThread(spriteId, threadId) {
    const t = activeThreads.find(t => t.spriteId === spriteId && t.threadId === threadId);
    if (t && t.abortCtrl) t.abortCtrl.abort();
    activeThreads = activeThreads.filter(t2 => t2 !== t);
    updateThreadUI();
  }

  function stopSpriteThreads(spriteId) {
    for (const t of activeThreads.filter(t => t.spriteId === spriteId)) {
      if (t.abortCtrl) t.abortCtrl.abort();
    }
    activeThreads = activeThreads.filter(t => t.spriteId !== spriteId);
    updateThreadUI();
  }

  // ── Events ────────────────────────────────────────────────────
  function fireEvent(type, target, data) {
    if (!Engine.state.running) return;
    const sprites = target === 'all'
      ? [...Engine.getAllSprites(), Engine.state.stage]
      : [Engine.getSprite(target)].filter(Boolean);

    for (const sprite of sprites) {
      for (const thread of sprite.threads) {
        launchThread(sprite.id, thread, type, data);
      }
    }
  }

  async function fireEventAndWait(type, target, data) {
    const sprites = target === 'all'
      ? [...Engine.getAllSprites(), Engine.state.stage]
      : [Engine.getSprite(target)].filter(Boolean);

    const promises = [];
    for (const sprite of sprites) {
      for (const thread of sprite.threads) {
        const t = launchThread(sprite.id, thread, type, data);
        if (t) promises.push(/* wait for completion - simplified */
          new Promise(resolve => setTimeout(resolve, 100))
        );
      }
    }
    await Promise.all(promises);
  }

  // ── Render loop ───────────────────────────────────────────────
  function scheduleFrame() {
    if (!Engine.state.running) return;
    animFrameId = requestAnimationFrame((now) => {
      if (now - lastFrameTime >= 16) { // ~60fps
        lastFrameTime = now;
        Renderer.render();
      }
      scheduleFrame();
    });
  }

  // ── UI updates ────────────────────────────────────────────────
  function updateThreadUI() {
    // Update thread dots in editor
    const selected = Engine.getSelectedSprite();
    if (!selected) return;

    document.querySelectorAll('.thread-item').forEach(el => {
      const tid = el.dataset.threadId;
      const running = activeThreads.some(t => t.spriteId === selected.id && t.threadId === tid);
      const error = activeThreads.find(t => t.spriteId === selected.id && t.threadId === tid && t.error);
      el.classList.toggle('running', running);
      el.classList.toggle('error', !!error);
    });
  }

  function showThreadError(spriteId, threadId, err) {
    const selected = Engine.getSelectedSprite();
    if (!selected || selected.id !== spriteId) return;

    const overlay = document.getElementById('error-overlay');
    const msg = err.toString ? err.toString() : String(err);
    overlay.textContent = '⚠ ' + msg;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 8000);
  }

  return {
    startAll,
    stopAll,
    startSpriteThreads,
    stopThread,
    stopSpriteThreads,
    fireEvent,
    fireEventAndWait,
    updateThreadUI,
    get startTime() { return startTime; },
    set startTime(v) { startTime = v; },
    get activeThreads() { return activeThreads; },
  };
})();
