// editor.js — code editor: IntelliSense, parameter hints, smart indent, undo/redo

const Editor = (() => {
  let currentSpriteId = null;
  let currentThreadId = null;
  let contextTarget   = null;

  // ── Undo / Redo ───────────────────────────────────────────────
  const _hist = new Map(); // threadId → { stack[], index }
  let _histTimer = null;

  function _getHist(tid) {
    if (!_hist.has(tid)) _hist.set(tid, { stack: [], index: -1 });
    return _hist.get(tid);
  }
  function _pushHist(value, ss, se) {
    if (!currentThreadId) return;
    const h = _getHist(currentThreadId);
    h.stack.length = h.index + 1;
    const top = h.stack[h.stack.length - 1];
    if (top && top.value === value) return;
    h.stack.push({ value, ss, se });
    if (h.stack.length > 200) h.stack.shift();
    h.index = h.stack.length - 1;
  }
  function _schedHist() {
    clearTimeout(_histTimer);
    _histTimer = setTimeout(() => {
      const ta = _ta(); _pushHist(ta.value, ta.selectionStart, ta.selectionEnd);
    }, 500);
  }
  function _commitHist() {
    clearTimeout(_histTimer);
    const ta = _ta(); _pushHist(ta.value, ta.selectionStart, ta.selectionEnd);
  }
  function _applyHist(snap) {
    const ta = _ta();
    ta.value = snap.value;
    ta.selectionStart = snap.ss;
    ta.selectionEnd   = snap.se;
    saveCurrentCode(); _syncLines(); AC.hide(); SigHelp.hide();
  }
  function _undo() {
    const h = _getHist(currentThreadId); if (h.index <= 0) return;
    h.index--; _applyHist(h.stack[h.index]);
  }
  function _redo() {
    const h = _getHist(currentThreadId); if (h.index >= h.stack.length - 1) return;
    h.index++; _applyHist(h.stack[h.index]);
  }

  // ── Completion definitions ────────────────────────────────────
  // params: array of { name, placeholder }
  // placeholder is what gets selected when user tabs to that param
  // overloads: alternate signatures shown in sig help
  const DEFS = [
    // Movement
    { label:'move_steps',     params:[{n:'steps',    p:'10'}],                        doc:'Move forward by steps in facing direction' },
    { label:'turn',           params:[{n:'degrees',  p:'15'}],                        doc:'Rotate clockwise by degrees' },
    { label:'go_to',          params:[{n:'x',p:'0'},{n:'y',p:'0'}],                   doc:'Teleport to position',
      overloads:['go_to(x, y)', 'go_to("random")'] },
    { label:'glide_to',       params:[{n:'x',p:'0'},{n:'y',p:'0'},{n:'seconds',p:'1'}], doc:'Smooth glide to position',
      overloads:['glide_to(x, y, seconds)', 'glide_to("random", seconds)'] },
    { label:'point_towards',  params:[{n:'target',   p:'"mouse_pointer"'}],           doc:'Point at target',
      overloads:['point_towards(degrees)', 'point_towards("sprite_name")', 'point_towards("mouse_pointer")'] },
    { label:'change_x',       params:[{n:'amount',   p:'10'}],                        doc:'Add to X position' },
    { label:'change_y',       params:[{n:'amount',   p:'10'}],                        doc:'Add to Y position' },
    { label:'set_x',          params:[{n:'x',        p:'0'}],                         doc:'Set X position' },
    { label:'set_y',          params:[{n:'y',        p:'0'}],                         doc:'Set Y position' },
    { label:'get_x',          params:[],                                              doc:'Returns current X' },
    { label:'get_y',          params:[],                                              doc:'Returns current Y' },
    { label:'get_direction',  params:[],                                              doc:'Returns direction (0=up, 90=right)' },
    { label:'on_edge',        params:[],                                              doc:'True if touching the stage edge' },
    { label:'bounce',         params:[],                                              doc:'Reverse direction off edge' },
    // Looks
    { label:'say',            params:[{n:'message',p:'"Hello!"'},{n:'seconds',p:'2'}], doc:'Speech bubble',
      overloads:['say(message, seconds)', 'say(message)  # permanent'] },
    { label:'set_costume',    params:[{n:'name',     p:'"Costume 1"'}],               doc:'Switch costume by name' },
    { label:'next_costume',   params:[],                                              doc:'Advance to next costume' },
    { label:'set_stage',      params:[{n:'name',     p:'"Backdrop 1"'}],              doc:'Change backdrop by name' },
    { label:'next_stage',     params:[],                                              doc:'Advance to next backdrop' },
    { label:'set_size',       params:[{n:'size',     p:'100'}],                       doc:'Set size (100 = default)' },
    { label:'change_size',    params:[{n:'amount',   p:'10'}],                        doc:'Add to size' },
    { label:'show',           params:[],                                              doc:'Make sprite visible' },
    { label:'hide',           params:[],                                              doc:'Make sprite invisible' },
    // Control
    { label:'wait',           params:[{n:'seconds',  p:'1'}],                         doc:'Pause thread. wait(0) = next frame' },
    { label:'stop',           params:[],                                              doc:'Stop all threads' },
    { label:'stop_this_thread', params:[],                                            doc:'Stop only this thread' },
    // Events
    { label:'broadcast',      params:[{n:'event_name', p:'"my_event"'}],              doc:'Fire event to all sprites' },
    { label:'broadcast_and_wait', params:[{n:'event_name', p:'"my_event"'}],          doc:'Fire and wait for all handlers' },
    // Sensing
    { label:'touching',       params:[{n:'target',   p:'"Sprite2"'}],                 doc:'True if touching sprite, "edge", "mouse_pointer"',
      overloads:['touching("sprite_name")', 'touching("edge")', 'touching("mouse_pointer")'] },
    { label:'touching_color', params:[{n:'hex',      p:'"#ff0000"'}],                 doc:'True if touching hex colour' },
    { label:'distance_to',    params:[{n:'target',   p:'"Sprite2"'}],                 doc:'Distance to sprite or "mouse_pointer"',
      overloads:['distance_to("sprite_name")', 'distance_to("mouse_pointer")'] },
    { label:'ask',            params:[{n:'message',  p:'"What is your name?"'}],      doc:'Show input prompt, returns answer' },
    { label:'key_pressed',    params:[{n:'key',      p:'"space"'}],                   doc:'True if key held: "space","up","down","left","right","a"...' },
    { label:'mouse_x',        params:[],                                              doc:'Mouse X in stage coords' },
    { label:'mouse_y',        params:[],                                              doc:'Mouse Y in stage coords' },
    { label:'mouse_down',     params:[],                                              doc:'True if mouse button held' },
    // Variables
    { label:'set_var',        params:[{n:'name',p:'"score"'},{n:'value',p:'0'}],      doc:'Set global variable' },
    { label:'get_var',        params:[{n:'name',p:'"score"'}],                        doc:'Get global variable' },
    { label:'set_sprite_var', params:[{n:'name',p:'"health"'},{n:'value',p:'100'}],   doc:'Set sprite-local variable' },
    { label:'get_sprite_var', params:[{n:'name',p:'"health"'}],                       doc:'Get sprite-local variable' },
    { label:'display_variable', params:[{n:'name',p:'"score"'},{n:'visible',p:'True'}], doc:'Show/hide variable on stage' },
    // Clones
    { label:'create_clone',   params:[],                                              doc:'Clone this sprite' },
    { label:'delete_clone',   params:[],                                              doc:'Delete this clone' },
    // Lists
    { label:'list_create',    params:[{n:'name',p:'"my_list"'}],                      doc:'Create a list' },
    { label:'list_add',       params:[{n:'name',p:'"my_list"'},{n:'value',p:'0'}],    doc:'Append to list' },
    { label:'list_remove',    params:[{n:'name',p:'"my_list"'},{n:'index',p:'1'}],    doc:'Remove at 1-based index' },
    { label:'list_get',       params:[{n:'name',p:'"my_list"'},{n:'index',p:'1'}],    doc:'Get at 1-based index' },
    // Layering
    { label:'go_to_front',    params:[],                                              doc:'Move to front layer' },
    { label:'go_back_layers', params:[{n:'n',p:'1'}],                                 doc:'Move back n layers' },
    // Sound
    { label:'play_sound',     params:[{n:'name',p:'"pop"'}],                          doc:'Play sound by name' },
    { label:'stop_all_sounds',params:[],                                              doc:'Stop all sounds' },
    { label:'set_volume',     params:[{n:'volume',p:'100'}],                          doc:'Set volume 0–100' },
    // Math
    { label:'random',         params:[{n:'min',p:'1'},{n:'max',p:'10'}],              doc:'Random float between min and max' },
    { label:'random_int',     params:[{n:'min',p:'1'},{n:'max',p:'10'}],              doc:'Random integer min–max inclusive' },
    { label:'timer',          params:[],                                              doc:'Seconds since game started' },
    { label:'reset_timer',    params:[],                                              doc:'Reset timer to 0' },
    // Event handler snippets
    { label:'game_start',     snippet:'def game_start():\n    ',                      doc:'Runs on green flag' },
    { label:'on_click',       snippet:'def on_click():\n    ',                        doc:'Runs when sprite clicked' },
    { label:'on_keypress',    snippet:'def on_keypress(key):\n    ',                  doc:'Runs on key press' },
    { label:'on_broadcast',   snippet:'def on_broadcast(event):\n    ',               doc:'Runs on broadcast()' },
    { label:'on_clone_start', snippet:'def on_clone_start():\n    ',                  doc:'Runs when clone created' },
    { label:'on_stage_loaded',snippet:'def on_stage_loaded(stage):\n    ',            doc:'Runs on set_stage()' },
    // Python builtins
    { label:'print',   params:[{n:'value',p:'""'}],   doc:'Print to browser console' },
    { label:'len',     params:[{n:'sequence',p:'[]'}], doc:'Length of string or list' },
    { label:'range',   params:[{n:'stop',p:'10'}],     doc:'Generate range of numbers',
      overloads:['range(stop)', 'range(start, stop)', 'range(start, stop, step)'] },
    { label:'str',     params:[{n:'value',p:'0'}],     doc:'Convert to string' },
    { label:'int',     params:[{n:'value',p:'0'}],     doc:'Convert to integer' },
    { label:'float',   params:[{n:'value',p:'0'}],     doc:'Convert to float' },
    { label:'abs',     params:[{n:'value',p:'0'}],     doc:'Absolute value' },
    { label:'round',   params:[{n:'value',p:'0'}],     doc:'Round number' },
    { label:'min',     params:[{n:'a',p:'0'},{n:'b',p:'0'}], doc:'Minimum of values' },
    { label:'max',     params:[{n:'a',p:'0'},{n:'b',p:'0'}], doc:'Maximum of values' },
    // Keywords
    { label:'True',   kw:true, doc:'Boolean true' },
    { label:'False',  kw:true, doc:'Boolean false' },
    { label:'None',   kw:true, doc:'Null value' },
    { label:'and',    kw:true, doc:'Logical and' },
    { label:'or',     kw:true, doc:'Logical or' },
    { label:'not',    kw:true, doc:'Logical not' },
    { label:'in',     kw:true, doc:'Membership test' },
    { label:'is',     kw:true, doc:'Identity test' },
    { label:'if',     kw:true, doc:'Conditional' },
    { label:'elif',   kw:true, doc:'Else-if' },
    { label:'else',   kw:true, doc:'Else branch' },
    { label:'while',  kw:true, doc:'While loop' },
    { label:'for',    kw:true, doc:'For loop' },
    { label:'def',    kw:true, doc:'Define function' },
    { label:'return', kw:true, doc:'Return value' },
    { label:'pass',   kw:true, doc:'No-op placeholder' },
    { label:'break',  kw:true, doc:'Exit loop' },
    { label:'continue',kw:true,doc:'Next iteration' },
  ];

  // Build a quick lookup by label
  const DEFS_BY_LABEL = Object.fromEntries(DEFS.map(d => [d.label, d]));

  // ── Build the insertion text with placeholder selection ───────
  // Returns { text, selectStart, selectEnd } relative to insertion point.
  // All params are filled with placeholder values; cursor lands on first one.
  function _buildInsert(def) {
    if (def.snippet) {
      return { text: def.snippet, selectStart: def.snippet.length, selectEnd: def.snippet.length };
    }
    if (def.kw) {
      return { text: def.label + ' ', selectStart: def.label.length + 1, selectEnd: def.label.length + 1 };
    }
    if (!def.params || def.params.length === 0) {
      return { text: def.label + '()', selectStart: def.label.length + 1, selectEnd: def.label.length + 1 };
    }
    // Build: funcname(placeholder1, placeholder2)
    // Cursor and selection land on the first placeholder
    const paramStr = def.params.map(p => p.p).join(', ');
    const text = def.label + '(' + paramStr + ')';
    const firstStart = def.label.length + 1;
    const firstEnd   = firstStart + def.params[0].p.length;
    return { text, selectStart: firstStart, selectEnd: firstEnd };
  }

  // ── Tab through placeholders ──────────────────────────────────
  // After accepting a completion, Tab should move to next param placeholder.
  // We store the insertion positions so Tab can jump between them.
  let _tabStops = []; // [{ start, end }] in textarea coordinates
  let _tabIdx   = -1;

  function _setTabStops(insertStart, def) {
    _tabStops = [];
    _tabIdx   = -1;
    if (!def || def.kw || def.snippet || !def.params || def.params.length === 0) return;

    let offset = insertStart + def.label.length + 1; // after 'func('
    for (const p of def.params) {
      _tabStops.push({ start: offset, end: offset + p.p.length });
      offset += p.p.length + 2; // ", "
    }
    _tabIdx = 0;
  }

  function _nextTabStop(ta) {
    if (_tabStops.length === 0) return false;
    // Verify cursor is still somewhere inside the call
    if (_tabIdx < _tabStops.length - 1) {
      _tabIdx++;
    } else {
      // Past last param — jump after closing paren
      const last = _tabStops[_tabStops.length - 1];
      ta.selectionStart = ta.selectionEnd = last.end + 1;
      _tabStops = []; _tabIdx = -1;
      return true;
    }
    const stop = _tabStops[_tabIdx];
    ta.selectionStart = stop.start;
    ta.selectionEnd   = stop.end;
    return true;
  }

  function _clearTabStops() { _tabStops = []; _tabIdx = -1; }

  // ── Signature Help ────────────────────────────────────────────
  // Shows while cursor is inside a function call's parentheses.
  const SigHelp = (() => {
    let el = null;
    let _active = false;

    function _ensure() {
      if (el) return;
      el = document.createElement('div');
      el.id = 'sig-help';
      document.body.appendChild(el);
    }

    // Analyse text before cursor to find innermost open call
    function update(ta) {
      _ensure();
      const text = ta.value.substring(0, ta.selectionStart);

      // Walk backwards to find the innermost unclosed '('
      let depth = 0;
      let parenPos = -1;
      let paramIndex = 0;
      for (let i = text.length - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === ')') { depth++; continue; }
        if (ch === '(') {
          if (depth === 0) { parenPos = i; break; }
          depth--;
        }
        if (ch === ',' && depth === 0) paramIndex++;
      }

      if (parenPos === -1) { hide(); return; }

      // Extract function name immediately before '('
      const before = text.substring(0, parenPos);
      const fnMatch = before.match(/([A-Za-z_]\w*)$/);
      if (!fnMatch) { hide(); return; }

      const fnName = fnMatch[1];
      const def    = DEFS_BY_LABEL[fnName];
      if (!def || def.kw || def.snippet) { hide(); return; }

      _active = true;
      _render(def, paramIndex, ta);
    }

    function _render(def, activeParam, ta) {
      const overloads = def.overloads || [_buildSig(def)];

      // Find which overload best matches param count
      let sigIdx = 0;
      for (let i = 0; i < overloads.length; i++) {
        const paramCount = (overloads[i].match(/,/g) || []).length + 1;
        if (activeParam < paramCount) { sigIdx = i; break; }
      }

      const sig = overloads[sigIdx];
      // Highlight the active parameter in the signature
      const highlighted = _highlightParam(sig, activeParam);

      const total   = overloads.length;
      const navHtml = total > 1
        ? `<span class="sh-nav"><span class="sh-arr" data-dir="-1">◂</span> ${sigIdx+1}/${total} <span class="sh-arr" data-dir="1">▸</span></span>`
        : '';

      el.innerHTML = `${navHtml}<span class="sh-sig">${highlighted}</span><span class="sh-doc">${def.doc}</span>`;
      el.style.display = 'flex';

      _position(ta);
    }

    function _buildSig(def) {
      if (!def.params || def.params.length === 0) return `${def.label}()`;
      return `${def.label}(${def.params.map(p => p.n).join(', ')})`;
    }

    function _highlightParam(sig, activeParam) {
      // Find the params portion inside parens
      const open  = sig.indexOf('(');
      const close = sig.lastIndexOf(')');
      if (open === -1 || close === -1) return _esc(sig);

      const fnPart     = _esc(sig.substring(0, open + 1));
      const closePart  = _esc(sig.substring(close));
      const paramsPart = sig.substring(open + 1, close);
      const params     = paramsPart.split(',');

      const highlighted = params.map((p, i) => {
        const escaped = _esc(p);
        return i === activeParam
          ? `<strong class="sh-active-param">${escaped}</strong>`
          : escaped;
      }).join(',');

      return fnPart + highlighted + closePart;
    }

    function _position(ta) {
      if (!el) return;
      const taRect = ta.getBoundingClientRect();
      const cs     = window.getComputedStyle(ta);

      // Mirror-div caret position
      const mirror = document.createElement('div');
      mirror.style.cssText = `
        position:fixed;visibility:hidden;pointer-events:none;
        top:0;left:0;white-space:pre-wrap;word-wrap:break-word;
        font-family:${cs.fontFamily};font-size:${cs.fontSize};
        line-height:${cs.lineHeight};padding:${cs.padding};
        border:${cs.border};box-sizing:${cs.boxSizing};
        width:${ta.clientWidth}px;
      `;
      const before = ta.value.substring(0, ta.selectionStart);
      mirror.innerHTML = before.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '<span id="sh-caret">|</span>';
      document.body.appendChild(mirror);
      const caret = document.getElementById('sh-caret');
      const cr    = caret.getBoundingClientRect();
      document.body.removeChild(mirror);

      const relX = cr.left - taRect.left + ta.scrollLeft;
      const relY = cr.top  - taRect.top  + ta.scrollTop;
      let x = taRect.left + relX;
      let y = taRect.top  + relY - 34; // show above cursor

      if (x + 400 > window.innerWidth) x = window.innerWidth - 404;
      if (x < 4) x = 4;
      if (y < 4) y = taRect.top + relY + parseFloat(cs.lineHeight) + 2;

      el.style.left = x + 'px';
      el.style.top  = y + 'px';
    }

    function hide() {
      _active = false;
      if (el) el.style.display = 'none';
    }

    function isActive() { return _active; }

    return { update, hide, isActive };
  })();

  // ── Autocomplete ──────────────────────────────────────────────
  const AC = (() => {
    let items  = [];
    let index  = 0;
    let active = false;
    let wordStart = 0;
    let popup = null;

    function _ensure() {
      if (popup) return;
      popup = document.createElement('div');
      popup.id = 'ac-popup';
      document.body.appendChild(popup);
    }

    function show(ta) {
      _ensure();
      const text  = ta.value.substring(0, ta.selectionStart);
      const match = text.match(/[A-Za-z_]\w*$/);
      const word  = match ? match[0] : '';
      if (!word) { hide(); return; }

      const lower = word.toLowerCase();
      items = DEFS.filter(d =>
        d.label.toLowerCase().startsWith(lower) && d.label.toLowerCase() !== lower
      );
      if (items.length === 0) { hide(); return; }

      wordStart = ta.selectionStart - word.length;
      index  = 0;
      active = true;

      _position(ta);
      _render();
      popup.style.display = 'block';
    }

    function hide() {
      active = false; items = [];
      if (popup) popup.style.display = 'none';
    }

    function isActive() { return active; }
    function moveDown() { if (active && items.length) { index = Math.min(index+1, Math.min(items.length,10)-1); _render(); } }
    function moveUp()   { if (active && items.length) { index = Math.max(index-1, 0); _render(); } }

    function accept(ta) {
      if (!active || !items.length) return false;
      const def = items[index];
      const cur = ta.selectionStart;
      const { text, selectStart, selectEnd } = _buildInsert(def);
      const before = ta.value.substring(0, wordStart);
      const after  = ta.value.substring(cur);
      ta.value = before + text + after;
      ta.selectionStart = wordStart + selectStart;
      ta.selectionEnd   = wordStart + selectEnd;
      // Set up tab stops so user can jump between params
      _setTabStops(wordStart, def);
      hide();
      return true;
    }

    function _render() {
      if (!popup) return;
      const show = items.slice(0, 10);
      popup.innerHTML = show.map((d, i) => {
        const sel  = i === index ? ' ac-sel' : '';
        const kind = d.snippet ? '⬡' : d.kw ? '◆' : 'ƒ';
        const kc   = d.snippet ? 'ac-kind-snip' : d.kw ? 'ac-kind-kw' : 'ac-kind-fn';
        const sig  = !d.kw && !d.snippet && d.params !== undefined
          ? `<span class="ac-params">(${d.params.map(p=>p.n).join(', ')})</span>` : '';
        return `<div class="ac-row${sel}" data-i="${i}">
          <span class="ac-kind ${kc}">${kind}</span>
          <span class="ac-name">${d.label}</span>${sig}
          <span class="ac-doc">${d.doc}</span>
        </div>`;
      }).join('');

      popup.querySelectorAll('.ac-row').forEach(row => {
        row.addEventListener('mousedown', e => {
          e.preventDefault();
          index = +row.dataset.i;
          const ta = _ta();
          if (accept(ta)) { saveCurrentCode(); _syncLines(); _commitHist(); }
        });
      });
    }

    function _position(ta) {
      if (!popup) return;
      const cs     = window.getComputedStyle(ta);
      const mirror = document.createElement('div');
      mirror.style.cssText = `
        position:fixed;visibility:hidden;pointer-events:none;
        top:0;left:0;white-space:pre-wrap;word-wrap:break-word;
        font-family:${cs.fontFamily};font-size:${cs.fontSize};
        line-height:${cs.lineHeight};padding:${cs.padding};
        border:${cs.border};box-sizing:${cs.boxSizing};
        width:${ta.clientWidth}px;
      `;
      const before = ta.value.substring(0, ta.selectionStart);
      mirror.innerHTML = before.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '<span id="ac-caret">|</span>';
      document.body.appendChild(mirror);
      const cr   = document.getElementById('ac-caret').getBoundingClientRect();
      document.body.removeChild(mirror);
      const taR  = ta.getBoundingClientRect();
      const relX = cr.left - taR.left + ta.scrollLeft;
      const relY = cr.top  - taR.top  + ta.scrollTop;
      let x = taR.left + relX;
      let y = taR.top  + relY + parseFloat(cs.lineHeight) + 2;
      const pw = 380;
      if (x + pw > window.innerWidth) x = window.innerWidth - pw - 4;
      if (x < 4) x = 4;
      const ph = Math.min(items.length, 10) * 32 + 8;
      if (y + ph > window.innerHeight) y = taR.top + relY - ph - 2;
      popup.style.left  = x + 'px';
      popup.style.top   = y + 'px';
      popup.style.width = pw + 'px';
    }

    return { show, hide, isActive, moveDown, moveUp, accept };
  })();

  // ── DOM ref ───────────────────────────────────────────────────
  const _ta = () => document.getElementById('code-editor');

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const ta = _ta();

    ta.addEventListener('keydown', e => {
      // Undo / Redo
      if ((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key==='z') { e.preventDefault(); _undo(); return; }
      if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); _redo(); return; }

      // AC navigation
      if (AC.isActive()) {
        if (e.key==='ArrowDown') { e.preventDefault(); AC.moveDown(); return; }
        if (e.key==='ArrowUp')   { e.preventDefault(); AC.moveUp();   return; }
        if (e.key==='Escape')    { e.preventDefault(); AC.hide(); _clearTabStops(); return; }
        if (e.key==='Enter') {
          e.preventDefault();
          if (AC.accept(ta)) { saveCurrentCode(); _syncLines(); _commitHist(); }
          return;
        }
      }

      // Tab — AC accept / tab stop / indent
      if (e.key === 'Tab') {
        e.preventDefault();

        // 1. Accept completion if open
        if (AC.isActive()) {
          if (AC.accept(ta)) { saveCurrentCode(); _syncLines(); _commitHist(); }
          return;
        }

        // 2. Move to next placeholder tab stop
        if (_tabStops.length > 0) {
          if (_nextTabStop(ta)) {
            SigHelp.update(ta);
            return;
          }
        }

        // 3. Normal indent / unindent
        const { selectionStart:ss, selectionEnd:se, value:v } = ta;
        if (ss === se) {
          ta.value = v.substring(0,ss) + '    ' + v.substring(se);
          ta.selectionStart = ta.selectionEnd = ss + 4;
        } else {
          const ls  = v.lastIndexOf('\n', ss-1)+1;
          const le  = v.indexOf('\n', se); const end = le===-1?v.length:le;
          const blk = v.substring(ls, end);
          const lns = blk.split('\n');
          let nb, nss, nse;
          if (e.shiftKey) {
            const s2 = lns.map(l=>l.replace(/^ {1,4}/,''));
            nb = s2.join('\n');
            nss = Math.max(ls, ss-(lns[0].length-s2[0].length));
            nse = se-(blk.length-nb.length);
          } else {
            nb  = lns.map(l=>'    '+l).join('\n');
            nss = ss+4; nse = se+lns.length*4;
          }
          ta.value = v.substring(0,ls)+nb+v.substring(end);
          ta.selectionStart=nss; ta.selectionEnd=Math.max(nss,nse);
        }
        _clearTabStops();
        saveCurrentCode(); _syncLines(); _commitHist(); return;
      }

      // Backspace — smart dedent (only when no tab stops active)
      if (e.key==='Backspace' && ta.selectionStart===ta.selectionEnd && ta.selectionStart>0) {
        const ss=ta.selectionStart, v=ta.value;
        const ls=v.lastIndexOf('\n',ss-1)+1;
        const prefix=v.substring(ls,ss);
        if (/^ +$/.test(prefix)) {
          e.preventDefault();
          const rem = prefix.length%4===0 ? 4 : prefix.length%4;
          ta.value=v.substring(0,ss-rem)+v.substring(ss);
          ta.selectionStart=ta.selectionEnd=ss-rem;
          _clearTabStops();
          saveCurrentCode(); _syncLines(); _commitHist(); return;
        }
      }

      // Enter — auto-indent, clear tab stops
      if (e.key==='Enter') {
        e.preventDefault();
        const {selectionStart:ss,selectionEnd:se,value:v}=ta;
        const ls=v.lastIndexOf('\n',ss-1)+1;
        const line=v.substring(ls,ss);
        const base=(line.match(/^(\s*)/)||['',''])[1];
        const extra=line.trimEnd().endsWith(':') ? '    ' : '';
        const ins='\n'+base+extra;
        ta.value=v.substring(0,ss)+ins+v.substring(se);
        ta.selectionStart=ta.selectionEnd=ss+ins.length;
        _clearTabStops();
        AC.hide(); SigHelp.hide();
        saveCurrentCode(); _syncLines(); _commitHist(); return;
      }

      // Any other key clears tab stops if cursor moved away from params
      if (!['Shift','Control','Alt','Meta','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        // Don't clear on arrow keys — user might be navigating within a param
      }
    });

    ta.addEventListener('input', () => {
      saveCurrentCode(); _syncLines(); _schedHist();
      AC.show(ta);
      SigHelp.update(ta);
    });

    ta.addEventListener('keyup', e => {
      // Ctrl+Space force AC
      if (e.key===' ' && (e.ctrlKey||e.metaKey)) { AC.show(ta); return; }
      // Update sig help on cursor moves
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        SigHelp.update(ta); AC.hide();
      }
    });

    ta.addEventListener('click', () => { SigHelp.update(ta); AC.hide(); });

    ta.addEventListener('scroll', () => {
      document.getElementById('line-numbers').scrollTop = ta.scrollTop;
    });

    document.addEventListener('mousedown', e => {
      const ap = document.getElementById('ac-popup');
      const sh = document.getElementById('sig-help');
      if (ap && !ap.contains(e.target) && e.target!==ta) AC.hide();
      if (sh && !sh.contains(e.target) && e.target!==ta) SigHelp.hide();
    });

    document.getElementById('btn-add-thread').addEventListener('click', addThread);
    document.getElementById('ctx-rename').addEventListener('click', renameThread);
    document.getElementById('ctx-delete').addEventListener('click', deleteThread);
    document.addEventListener('click', e => {
      if (!e.target.closest('#context-menu') && !e.target.closest('.thread-item')) hideContextMenu();
    });

    _syncLines();
  }

  // ── Thread management ─────────────────────────────────────────
  function addThread() {
    const sprite=Engine.getSelectedSprite(); if(!sprite) return;
    const t={id:Utils.uid(), name:`thread${sprite.threads.length+1}`, code:''};
    sprite.threads.push(t); renderThreadList(sprite); selectThread(sprite, t.id);
  }
  function renameThread() {
    if(!contextTarget) return;
    const sprite=Engine.getSelectedSprite();
    const t=sprite.threads.find(t=>t.id===contextTarget); if(!t) return;
    const n=prompt('Thread name:', t.name);
    if(n&&n.trim()){t.name=n.trim(); renderThreadList(sprite);}
    hideContextMenu();
  }
  function deleteThread() {
    if(!contextTarget) return;
    const sprite=Engine.getSelectedSprite();
    if(sprite.threads.length<=1){alert('Cannot delete the last thread.'); hideContextMenu(); return;}
    sprite.threads=sprite.threads.filter(t=>t.id!==contextTarget);
    if(currentThreadId===contextTarget) selectThread(sprite, sprite.threads[0].id);
    renderThreadList(sprite); hideContextMenu();
  }
  function hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden'); contextTarget=null;
  }
  function showContextMenu(x,y) {
    const m=document.getElementById('context-menu');
    m.style.left=x+'px'; m.style.top=y+'px'; m.classList.remove('hidden');
  }

  // ── Thread list ───────────────────────────────────────────────
  function renderThreadList(sprite) {
    const list=document.getElementById('thread-list');
    if(!sprite){list.innerHTML=''; return;}
    list.innerHTML=sprite.threads.map(t=>`
      <div class="thread-item ${t.id===currentThreadId?'active':''}" data-thread-id="${t.id}">
        <div class="thread-dot"></div>
        <div class="thread-name">${_esc(t.name)}</div>
      </div>`).join('');
    list.querySelectorAll('.thread-item').forEach(el=>{
      el.addEventListener('click', ()=>selectThread(sprite, el.dataset.threadId));
      el.addEventListener('contextmenu', e=>{
        e.preventDefault(); contextTarget=el.dataset.threadId; showContextMenu(e.clientX, e.clientY);
      });
    });
  }

  // ── Select / load ─────────────────────────────────────────────
  function selectThread(sprite, threadId) {
    saveCurrentCode();
    currentSpriteId=sprite.id; currentThreadId=threadId;
    const thread=sprite.threads.find(t=>t.id===threadId); if(!thread) return;
    const ta=_ta();
    ta.value=thread.code||'';
    if(_getHist(threadId).stack.length===0) _pushHist(ta.value,0,0);
    document.getElementById('current-thread-label').textContent=`${sprite.name} → ${thread.name}`;
    _syncLines(); renderThreadList(sprite);
    AC.hide(); SigHelp.hide(); _clearTabStops();
    document.getElementById('error-overlay').classList.add('hidden');
  }

  function loadSprite(sprite) {
    if(!sprite){
      _ta().value='';
      document.getElementById('thread-list').innerHTML='';
      document.getElementById('current-thread-label').textContent='';
      return;
    }
    if(!sprite.threads||sprite.threads.length===0)
      sprite.threads=[{id:Utils.uid(), name:'main', code:''}];
    renderThreadList(sprite);
    selectThread(sprite, sprite.threads[0].id);
  }

  function saveCurrentCode() {
    if(!currentSpriteId||!currentThreadId) return;
    const sprite=Engine.getSprite(currentSpriteId); if(!sprite) return;
    const thread=sprite.threads.find(t=>t.id===currentThreadId);
    if(thread) thread.code=_ta().value;
  }

  function _syncLines() {
    const ta=_ta();
    const n=ta.value.split('\n').length;
    document.getElementById('line-numbers').innerHTML=
      Array.from({length:n},(_,i)=>i+1).join('<br>');
  }

  function _esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { init, loadSprite, renderThreadList, selectThread, saveCurrentCode };
})();
