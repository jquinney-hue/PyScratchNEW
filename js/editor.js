// editor.js — code editor with IntelliSense, smart indent, undo/redo

const Editor = (() => {
  let currentSpriteId = null;
  let currentThreadId = null;
  let contextTarget   = null;

  // ── Undo/redo — per-thread history ───────────────────────────
  const _history = new Map(); // threadId -> { stack[], index }

  function _getHist(tid) {
    if (!_history.has(tid)) _history.set(tid, { stack: [], index: -1 });
    return _history.get(tid);
  }

  function _pushHist(value, selStart, selEnd) {
    if (!currentThreadId) return;
    const h = _getHist(currentThreadId);
    // Truncate forward history
    h.stack.length = h.index + 1;
    // Don't duplicate top
    const top = h.stack[h.stack.length - 1];
    if (top && top.value === value) return;
    h.stack.push({ value, selStart, selEnd });
    if (h.stack.length > 200) h.stack.shift();
    h.index = h.stack.length - 1;
  }

  function _applyHist(snap) {
    const ta = _ta();
    ta.value = snap.value;
    ta.selectionStart = snap.selStart;
    ta.selectionEnd   = snap.selEnd;
    saveCurrentCode();
    _syncLineNumbers();
    AC.hide();
  }

  function _undo() {
    if (!currentThreadId) return;
    const h = _getHist(currentThreadId);
    if (h.index <= 0) return;
    h.index--;
    _applyHist(h.stack[h.index]);
  }

  function _redo() {
    if (!currentThreadId) return;
    const h = _getHist(currentThreadId);
    if (h.index >= h.stack.length - 1) return;
    h.index++;
    _applyHist(h.stack[h.index]);
  }

  // Debounced history push — called after normal typing
  let _histTimer = null;
  function _scheduleHist() {
    clearTimeout(_histTimer);
    _histTimer = setTimeout(() => {
      const ta = _ta();
      _pushHist(ta.value, ta.selectionStart, ta.selectionEnd);
    }, 500);
  }

  // Immediate history push — called after structural edits (tab, enter, etc.)
  function _commitHist() {
    clearTimeout(_histTimer);
    const ta = _ta();
    _pushHist(ta.value, ta.selectionStart, ta.selectionEnd);
  }

  // ── IntelliSense completions ──────────────────────────────────
  const COMPLETIONS = [
    // Movement
    { label:'move_steps',      sig:'move_steps(steps)',              doc:'Move forward by steps in facing direction' },
    { label:'turn',            sig:'turn(degrees)',                  doc:'Rotate clockwise by degrees' },
    { label:'go_to',           sig:'go_to(x, y)',                   doc:'Teleport to x,y or go_to("random")' },
    { label:'glide_to',        sig:'glide_to(x, y, seconds)',       doc:'Smooth glide to position over seconds' },
    { label:'point_towards',   sig:'point_towards(target)',          doc:'Point at sprite name or "mouse_pointer"' },
    { label:'change_x',        sig:'change_x(amount)',              doc:'Add to X position' },
    { label:'change_y',        sig:'change_y(amount)',              doc:'Add to Y position' },
    { label:'set_x',           sig:'set_x(x)',                      doc:'Set X position' },
    { label:'set_y',           sig:'set_y(y)',                      doc:'Set Y position' },
    { label:'get_x',           sig:'get_x()',                       doc:'Returns current X' },
    { label:'get_y',           sig:'get_y()',                       doc:'Returns current Y' },
    { label:'get_direction',   sig:'get_direction()',               doc:'Returns direction (0=up, 90=right)' },
    { label:'on_edge',         sig:'on_edge()',                     doc:'True if touching the stage edge' },
    { label:'bounce',          sig:'bounce()',                      doc:'Reverse direction off edge' },
    // Looks
    { label:'say',             sig:'say(message, seconds)',          doc:'Speech bubble. Omit seconds to show forever' },
    { label:'set_costume',     sig:'set_costume(name)',             doc:'Switch costume by name' },
    { label:'next_costume',    sig:'next_costume()',                doc:'Advance to next costume' },
    { label:'set_stage',       sig:'set_stage(name)',               doc:'Change backdrop by name' },
    { label:'next_stage',      sig:'next_stage()',                  doc:'Advance to next backdrop' },
    { label:'set_size',        sig:'set_size(size)',                doc:'Set size (100 = default)' },
    { label:'change_size',     sig:'change_size(amount)',           doc:'Add to size' },
    { label:'show',            sig:'show()',                        doc:'Make sprite visible' },
    { label:'hide',            sig:'hide()',                        doc:'Make sprite invisible' },
    // Control
    { label:'wait',            sig:'wait(seconds)',                 doc:'Pause thread. wait(0) = next frame' },
    { label:'stop',            sig:'stop()',                        doc:'Stop all threads' },
    { label:'stop_this_thread',sig:'stop_this_thread()',           doc:'Stop only this thread' },
    // Events
    { label:'broadcast',       sig:'broadcast(event_name)',         doc:'Fire event to all sprites' },
    { label:'broadcast_and_wait', sig:'broadcast_and_wait(event_name)', doc:'Fire and wait for all handlers' },
    // Sensing
    { label:'touching',        sig:'touching(target)',              doc:'True if touching sprite, "edge", "mouse_pointer"' },
    { label:'touching_color',  sig:'touching_color("#rrggbb")',     doc:'True if touching hex colour' },
    { label:'distance_to',     sig:'distance_to(target)',           doc:'Distance to sprite or "mouse_pointer"' },
    { label:'ask',             sig:'ask(message)',                  doc:'Show input prompt, returns answer' },
    { label:'key_pressed',     sig:'key_pressed(key)',              doc:'True if key held: "space","up","a"...' },
    { label:'mouse_x',         sig:'mouse_x()',                     doc:'Mouse X in stage coords' },
    { label:'mouse_y',         sig:'mouse_y()',                     doc:'Mouse Y in stage coords' },
    { label:'mouse_down',      sig:'mouse_down()',                  doc:'True if mouse button held' },
    // Variables
    { label:'set_var',         sig:'set_var(name, value)',          doc:'Set global variable' },
    { label:'get_var',         sig:'get_var(name)',                 doc:'Get global variable' },
    { label:'set_sprite_var',  sig:'set_sprite_var(name, value)',   doc:'Set sprite-local variable' },
    { label:'get_sprite_var',  sig:'get_sprite_var(name)',          doc:'Get sprite-local variable' },
    { label:'display_variable',sig:'display_variable(name, True)', doc:'Show/hide variable on stage' },
    // Clones
    { label:'create_clone',    sig:'create_clone()',               doc:'Clone this sprite' },
    { label:'delete_clone',    sig:'delete_clone()',               doc:'Delete this clone' },
    // Lists
    { label:'list_create',     sig:'list_create(name)',            doc:'Create a list' },
    { label:'list_add',        sig:'list_add(name, value)',        doc:'Append to list' },
    { label:'list_remove',     sig:'list_remove(name, index)',     doc:'Remove at 1-based index' },
    { label:'list_get',        sig:'list_get(name, index)',        doc:'Get at 1-based index' },
    // Layering
    { label:'go_to_front',     sig:'go_to_front()',               doc:'Move to front layer' },
    { label:'go_back_layers',  sig:'go_back_layers(n)',           doc:'Move back n layers' },
    // Sound
    { label:'play_sound',      sig:'play_sound(name)',             doc:'Play sound by name' },
    { label:'stop_all_sounds', sig:'stop_all_sounds()',           doc:'Stop all sounds' },
    { label:'set_volume',      sig:'set_volume(0-100)',           doc:'Set volume 0–100' },
    // Math
    { label:'random',          sig:'random(min, max)',             doc:'Random float between min and max' },
    { label:'random_int',      sig:'random_int(min, max)',        doc:'Random integer min–max inclusive' },
    { label:'timer',           sig:'timer()',                      doc:'Seconds since game started' },
    { label:'reset_timer',     sig:'reset_timer()',               doc:'Reset timer to 0' },
    // Event handler snippets
    { label:'game_start',      sig:'def game_start():',           doc:'Runs on green flag', snippet:true },
    { label:'on_click',        sig:'def on_click():',             doc:'Runs when sprite clicked', snippet:true },
    { label:'on_keypress',     sig:'def on_keypress(key):',       doc:'Runs on key press', snippet:true },
    { label:'on_broadcast',    sig:'def on_broadcast(event):',   doc:'Runs on broadcast()', snippet:true },
    { label:'on_clone_start',  sig:'def on_clone_start():',      doc:'Runs when clone created', snippet:true },
    { label:'on_stage_loaded', sig:'def on_stage_loaded(stage):',doc:'Runs on set_stage()', snippet:true },
    // Python builtins
    { label:'print',   sig:'print(value)',    doc:'Print to browser console' },
    { label:'len',     sig:'len(sequence)',   doc:'Length of string or list' },
    { label:'range',   sig:'range(stop)',     doc:'Generate range of numbers' },
    { label:'str',     sig:'str(value)',      doc:'Convert to string' },
    { label:'int',     sig:'int(value)',      doc:'Convert to integer' },
    { label:'float',   sig:'float(value)',    doc:'Convert to float' },
    { label:'abs',     sig:'abs(value)',      doc:'Absolute value' },
    { label:'round',   sig:'round(value)',    doc:'Round number' },
    { label:'min',     sig:'min(a, b)',       doc:'Minimum of values' },
    { label:'max',     sig:'max(a, b)',       doc:'Maximum of values' },
    // Keywords (no parens)
    { label:'True',    sig:'True',    doc:'Boolean true',  kw:true },
    { label:'False',   sig:'False',   doc:'Boolean false', kw:true },
    { label:'None',    sig:'None',    doc:'Null value',    kw:true },
    { label:'and',     sig:'and',     doc:'Logical and',   kw:true },
    { label:'or',      sig:'or',      doc:'Logical or',    kw:true },
    { label:'not',     sig:'not',     doc:'Logical not',   kw:true },
    { label:'in',      sig:'in',      doc:'Membership test', kw:true },
    { label:'is',      sig:'is',      doc:'Identity test', kw:true },
    { label:'if',      sig:'if',      doc:'Conditional',   kw:true },
    { label:'elif',    sig:'elif',    doc:'Else-if',        kw:true },
    { label:'else',    sig:'else:',   doc:'Else branch',   kw:true },
    { label:'while',   sig:'while',   doc:'While loop',    kw:true },
    { label:'for',     sig:'for',     doc:'For loop',      kw:true },
    { label:'def',     sig:'def',     doc:'Define function', kw:true },
    { label:'return',  sig:'return',  doc:'Return value',  kw:true },
    { label:'pass',    sig:'pass',    doc:'No-op placeholder', kw:true },
    { label:'break',   sig:'break',   doc:'Exit loop',     kw:true },
    { label:'continue',sig:'continue',doc:'Next iteration', kw:true },
  ];

  // ── Autocomplete controller ───────────────────────────────────
  const AC = (() => {
    let items   = [];
    let index   = 0;
    let active  = false;
    let wordStart = 0; // textarea offset where the typed word began

    let popup = null;

    function _ensure() {
      if (popup) return;
      popup = document.createElement('div');
      popup.id = 'ac-popup';
      document.body.appendChild(popup);
    }

    function show(ta) {
      _ensure();
      const text   = ta.value.substring(0, ta.selectionStart);
      const match  = text.match(/[A-Za-z_]\w*$/);
      const word   = match ? match[0] : '';

      if (!word) { hide(); return; }

      const lower = word.toLowerCase();
      items = COMPLETIONS.filter(c =>
        c.label.toLowerCase().startsWith(lower) && c.label.toLowerCase() !== lower
      );

      if (items.length === 0) { hide(); return; }

      wordStart = ta.selectionStart - word.length;
      index     = 0;
      active    = true;

      _position(ta);
      _render();
      popup.style.display = 'block';
    }

    function hide() {
      active = false;
      items  = [];
      if (popup) popup.style.display = 'none';
    }

    function isActive() { return active; }

    function moveDown() { if (active) { index = Math.min(index+1, items.length-1); _render(); } }
    function moveUp()   { if (active) { index = Math.max(index-1, 0);              _render(); } }

    function accept(ta) {
      if (!active || items.length === 0) return false;
      const item    = items[index];
      const cur     = ta.selectionStart;
      const before  = ta.value.substring(0, wordStart);
      const after   = ta.value.substring(cur);

      let insert = item.sig;
      let cursor;

      if (item.snippet) {
        // snippet: "def game_start():" → insert as-is, cursor at end
        insert = item.sig + '\n    ';
        cursor = wordStart + insert.length;
      } else if (item.kw) {
        // keyword: insert with a trailing space
        insert = item.sig + ' ';
        cursor = wordStart + insert.length;
      } else {
        // function: insert signature, place cursor inside first parens
        insert = item.sig;
        const paren = insert.indexOf('(');
        cursor = paren !== -1 ? wordStart + paren + 1 : wordStart + insert.length;
      }

      ta.value = before + insert + after;
      ta.selectionStart = ta.selectionEnd = cursor;
      hide();
      return true;
    }

    function _render() {
      if (!popup) return;
      const visible = items.slice(0, 10);
      popup.innerHTML = visible.map((c, i) => {
        const active = i === index ? ' ac-sel' : '';
        const kind   = c.snippet ? '⬡' : c.kw ? '◆' : 'ƒ';
        const kindCls= c.snippet ? 'ac-kind-snip' : c.kw ? 'ac-kind-kw' : 'ac-kind-fn';
        return `<div class="ac-row${active}" data-i="${i}">
          <span class="ac-kind ${kindCls}">${kind}</span>
          <span class="ac-name">${c.label}</span>
          <span class="ac-sig">${_sigPreview(c)}</span>
          <span class="ac-doc">${c.doc}</span>
        </div>`;
      }).join('');

      popup.querySelectorAll('.ac-row').forEach(row => {
        row.addEventListener('mousedown', e => {
          e.preventDefault();
          index = +row.dataset.i;
          const ta = document.getElementById('code-editor');
          if (accept(ta)) {
            saveCurrentCode_();
            syncLines_();
            _commitHist_();
          }
        });
      });
    }

    // Position the popup below the cursor using a mirror div
    function _position(ta) {
      if (!popup) return;

      // Build a mirror div that matches the textarea's rendering
      const mirror = document.createElement('div');
      const cs     = window.getComputedStyle(ta);
      mirror.style.cssText = `
        position:fixed; visibility:hidden; pointer-events:none;
        top:0; left:0; white-space:pre-wrap; word-wrap:break-word;
        font-family:${cs.fontFamily}; font-size:${cs.fontSize};
        line-height:${cs.lineHeight}; padding:${cs.padding};
        border:${cs.border}; box-sizing:${cs.boxSizing};
        width:${ta.clientWidth}px; overflow:hidden;
      `;
      // Text up to cursor, then a sentinel span
      const textBefore = ta.value.substring(0, ta.selectionStart);
      // Escape HTML
      mirror.innerHTML =
        textBefore.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/\n/g,'<br>') +
        '<span id="ac-caret">|</span>';
      document.body.appendChild(mirror);

      const caretEl   = document.getElementById('ac-caret');
      const caretRect = caretEl.getBoundingClientRect();
      document.body.removeChild(mirror);

      const taRect    = ta.getBoundingClientRect();
      // Pixel offset inside textarea (accounting for scroll)
      const relX = caretRect.left - taRect.left + ta.scrollLeft;
      const relY = caretRect.top  - taRect.top  + ta.scrollTop;

      // Absolute page coords
      let x = taRect.left + relX;
      let y = taRect.top  + relY + parseFloat(cs.lineHeight) + 2;

      // Keep inside viewport
      const pw = 380;
      if (x + pw > window.innerWidth)  x = window.innerWidth - pw - 8;
      if (x < 0) x = 4;

      // Flip above if would go off bottom
      const ph = Math.min(items.length, 10) * 30 + 8;
      if (y + ph > window.innerHeight) y = taRect.top + relY - ph - 2;

      popup.style.left = x + 'px';
      popup.style.top  = y + 'px';
      popup.style.width = pw + 'px';
    }

    // Show just params for preview
    function _sigPreview(c) {
      if (c.kw || c.snippet) return '';
      const m = c.sig.match(/\(([^)]*)\)/);
      return m ? `<span class="ac-params">(${m[1]})</span>` : '';
    }

    return { show, hide, isActive, moveDown, moveUp, accept };
  })();

  // Callbacks for AC to call back into Editor scope
  function saveCurrentCode_() { saveCurrentCode(); }
  function syncLines_()       { _syncLineNumbers(); }
  function _commitHist_()     { _commitHist(); }

  // ── DOM helpers ───────────────────────────────────────────────
  const _ta = () => document.getElementById('code-editor');

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const ta = _ta();

    // ── keydown — structural keys ──────────────────────────────
    ta.addEventListener('keydown', e => {

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault(); _undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault(); _redo(); return;
      }

      // Autocomplete navigation
      if (AC.isActive()) {
        if (e.key === 'ArrowDown')  { e.preventDefault(); AC.moveDown(); return; }
        if (e.key === 'ArrowUp')    { e.preventDefault(); AC.moveUp();   return; }
        if (e.key === 'Escape')     { e.preventDefault(); AC.hide();     return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (AC.accept(ta)) { saveCurrentCode(); _syncLineNumbers(); _commitHist(); }
          return;
        }
      }

      // Tab — indent / unindent
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: ss, selectionEnd: se, value: v } = ta;

        if (ss === se) {
          // No selection — insert 4 spaces
          ta.value = v.substring(0, ss) + '    ' + v.substring(se);
          ta.selectionStart = ta.selectionEnd = ss + 4;
        } else {
          // Multi-line block indent/unindent
          const lineStart = v.lastIndexOf('\n', ss - 1) + 1;
          const lineEnd   = v.indexOf('\n', se);
          const end       = lineEnd === -1 ? v.length : lineEnd;
          const block     = v.substring(lineStart, end);
          const lines     = block.split('\n');

          let newBlock, newSs, newSe;
          if (e.shiftKey) {
            const stripped = lines.map(l => l.replace(/^ {1,4}/, ''));
            newBlock = stripped.join('\n');
            const removedFirst = lines[0].length - stripped[0].length;
            newSs = Math.max(lineStart, ss - removedFirst);
            newSe = se - (block.length - newBlock.length);
          } else {
            newBlock = lines.map(l => '    ' + l).join('\n');
            newSs    = ss + 4;
            newSe    = se + lines.length * 4;
          }

          ta.value = v.substring(0, lineStart) + newBlock + v.substring(end);
          ta.selectionStart = newSs;
          ta.selectionEnd   = Math.max(newSs, newSe);
        }

        saveCurrentCode(); _syncLineNumbers(); _commitHist(); return;
      }

      // Backspace — smart dedent
      if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd && ta.selectionStart > 0) {
        const { selectionStart: ss, value: v } = ta;
        const lineStart = v.lastIndexOf('\n', ss - 1) + 1;
        const prefix    = v.substring(lineStart, ss);
        if (/^ +$/.test(prefix)) {
          e.preventDefault();
          // Remove back to previous 4-space stop
          const rem = prefix.length % 4 === 0 ? 4 : prefix.length % 4;
          ta.value = v.substring(0, ss - rem) + v.substring(ss);
          ta.selectionStart = ta.selectionEnd = ss - rem;
          saveCurrentCode(); _syncLineNumbers(); _commitHist(); return;
        }
      }

      // Enter — auto-indent
      if (e.key === 'Enter') {
        e.preventDefault();
        const { selectionStart: ss, selectionEnd: se, value: v } = ta;
        const lineStart   = v.lastIndexOf('\n', ss - 1) + 1;
        const lineText    = v.substring(lineStart, ss);
        const baseIndent  = (lineText.match(/^(\s*)/) || ['',''])[1];
        const extraIndent = lineText.trimEnd().endsWith(':') ? '    ' : '';
        const ins         = '\n' + baseIndent + extraIndent;
        ta.value = v.substring(0, ss) + ins + v.substring(se);
        ta.selectionStart = ta.selectionEnd = ss + ins.length;
        AC.hide();
        saveCurrentCode(); _syncLineNumbers(); _commitHist(); return;
      }
    });

    // ── input — fires after character inserted ─────────────────
    ta.addEventListener('input', () => {
      saveCurrentCode();
      _syncLineNumbers();
      _scheduleHist();
      AC.show(ta);
    });

    // ── scroll — sync gutter ───────────────────────────────────
    ta.addEventListener('scroll', () => {
      document.getElementById('line-numbers').scrollTop = ta.scrollTop;
    });

    // ── click — hide AC ────────────────────────────────────────
    ta.addEventListener('mousedown', () => AC.hide());

    // ── Ctrl+Space — force AC ──────────────────────────────────
    ta.addEventListener('keyup', e => {
      if (e.key === ' ' && (e.ctrlKey || e.metaKey)) AC.show(ta);
    });

    // Global click — hide AC if clicking outside
    document.addEventListener('mousedown', e => {
      const popup = document.getElementById('ac-popup');
      if (popup && !popup.contains(e.target) && e.target !== ta) AC.hide();
    });

    document.getElementById('btn-add-thread').addEventListener('click', addThread);
    document.getElementById('ctx-rename').addEventListener('click', renameThread);
    document.getElementById('ctx-delete').addEventListener('click', deleteThread);
    document.addEventListener('click', e => {
      if (!e.target.closest('#context-menu') && !e.target.closest('.thread-item')) {
        hideContextMenu();
      }
    });

    _syncLineNumbers();
  }

  // ── Thread management ─────────────────────────────────────────
  function addThread() {
    const sprite = Engine.getSelectedSprite(); if (!sprite) return;
    const thread = { id: Utils.uid(), name: `thread${sprite.threads.length+1}`, code: '' };
    sprite.threads.push(thread);
    renderThreadList(sprite);
    selectThread(sprite, thread.id);
  }

  function renameThread() {
    if (!contextTarget) return;
    const sprite = Engine.getSelectedSprite();
    const thread = sprite.threads.find(t => t.id === contextTarget); if (!thread) return;
    const n = prompt('Thread name:', thread.name);
    if (n && n.trim()) { thread.name = n.trim(); renderThreadList(sprite); }
    hideContextMenu();
  }

  function deleteThread() {
    if (!contextTarget) return;
    const sprite = Engine.getSelectedSprite();
    if (sprite.threads.length <= 1) { alert('Cannot delete the last thread.'); hideContextMenu(); return; }
    sprite.threads = sprite.threads.filter(t => t.id !== contextTarget);
    if (currentThreadId === contextTarget) selectThread(sprite, sprite.threads[0].id);
    renderThreadList(sprite);
    hideContextMenu();
  }

  function hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
    contextTarget = null;
  }

  function showContextMenu(x, y) {
    const m = document.getElementById('context-menu');
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.classList.remove('hidden');
  }

  // ── Render thread list ────────────────────────────────────────
  function renderThreadList(sprite) {
    const list = document.getElementById('thread-list');
    if (!sprite) { list.innerHTML = ''; return; }
    list.innerHTML = sprite.threads.map(t => `
      <div class="thread-item ${t.id === currentThreadId ? 'active' : ''}"
           data-thread-id="${t.id}">
        <div class="thread-dot"></div>
        <div class="thread-name">${_esc(t.name)}</div>
      </div>`).join('');
    list.querySelectorAll('.thread-item').forEach(el => {
      el.addEventListener('click', () => selectThread(sprite, el.dataset.threadId));
      el.addEventListener('contextmenu', e => {
        e.preventDefault(); contextTarget = el.dataset.threadId;
        showContextMenu(e.clientX, e.clientY);
      });
    });
  }

  // ── Select / load ─────────────────────────────────────────────
  function selectThread(sprite, threadId) {
    saveCurrentCode();
    currentSpriteId = sprite.id;
    currentThreadId = threadId;
    const thread = sprite.threads.find(t => t.id === threadId); if (!thread) return;
    const ta = _ta();
    ta.value = thread.code || '';
    // Seed history
    if (_getHist(threadId).stack.length === 0) _pushHist(ta.value, 0, 0);
    document.getElementById('current-thread-label').textContent = `${sprite.name} → ${thread.name}`;
    _syncLineNumbers();
    renderThreadList(sprite);
    AC.hide();
    document.getElementById('error-overlay').classList.add('hidden');
  }

  function loadSprite(sprite) {
    if (!sprite) {
      _ta().value = '';
      document.getElementById('thread-list').innerHTML = '';
      document.getElementById('current-thread-label').textContent = '';
      return;
    }
    if (!sprite.threads || sprite.threads.length === 0)
      sprite.threads = [{ id: Utils.uid(), name: 'main', code: '' }];
    renderThreadList(sprite);
    selectThread(sprite, sprite.threads[0].id);
  }

  function saveCurrentCode() {
    if (!currentSpriteId || !currentThreadId) return;
    const sprite = Engine.getSprite(currentSpriteId); if (!sprite) return;
    const thread = sprite.threads.find(t => t.id === currentThreadId);
    if (thread) thread.code = _ta().value;
  }

  function _syncLineNumbers() {
    const ta = _ta();
    const n  = ta.value.split('\n').length;
    document.getElementById('line-numbers').innerHTML =
      Array.from({length: n}, (_, i) => i + 1).join('<br>');
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, loadSprite, renderThreadList, selectThread, saveCurrentCode };
})();
