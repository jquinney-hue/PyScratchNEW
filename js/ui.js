// ui.js — sprite panel, properties, variable display

const UI = (() => {
  let draggingSprite = null;
  let dragOffsetX = 0, dragOffsetY = 0;

  function init() {
    document.getElementById('btn-add-sprite').addEventListener('click', addSprite);
    document.getElementById('btn-delete-sprite').addEventListener('click', deleteSprite);

    ['prop-name','prop-x','prop-y','prop-size','prop-dir','prop-rotation'].forEach(id => {
      document.getElementById(id).addEventListener('input',  onPropChange);
      document.getElementById(id).addEventListener('change', onPropChange);
    });

    initDirWheel();

    const canvas = document.getElementById('stage-canvas');
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', () => { draggingSprite = null; });

    document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

    Engine.setVariableUpdateCallback(updateVariableDisplay);

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });
  }

  // ── Sprite CRUD ───────────────────────────────────────────────
  async function addSprite() {
    const sprite = Engine.addSprite(); // uses DEFAULT_SPRITE_URL via createSprite
    await Renderer.loadSpriteImage(sprite);
    Engine.selectSprite(sprite.id);
    renderSpritePanel();
    Editor.loadSprite(sprite);
    CostumePanel.load(sprite);
    Renderer.render(); // immediately show new sprite on canvas
  }

  function deleteSprite() {
    const sel = Engine.getSelectedSprite();
    if (!sel || sel.isStage) { alert('The stage cannot be deleted.'); return; }
    if (!confirm(`Delete "${sel.name}"?`)) return;
    Scheduler.stopSpriteThreads(sel.id);
    Engine.deleteSprite(sel.id);
    const next = Engine.getSelectedSprite() || Engine.state.stage;
    Engine.selectSprite(next.id);
    renderSpritePanel();
    Editor.loadSprite(next);
    CostumePanel.load(next);
    Renderer.render();
  }

  // ── Sprite panel ──────────────────────────────────────────────
  function renderSpritePanel() {
    const list     = document.getElementById('sprite-list');
    const selected = Engine.state.selectedSpriteId;
    const targets  = [Engine.state.stage, ...Engine.getAllSprites()];

    list.innerHTML = '';
    for (const s of targets) {
      const div = document.createElement('div');
      div.className = 'sprite-thumb' + (s.id === selected ? ' active' : '');
      div.dataset.spriteId = s.id;

      const imgBox = document.createElement('div');
      imgBox.className = 'sprite-thumb-img';

      // Always use live _img if available, else emoji fallback
      if (s._img) {
        const img = document.createElement('img');
        img.src = s._img.src;
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
        imgBox.appendChild(img);
      } else {
        imgBox.textContent = s.isStage ? '🎬' : '🐱';
        imgBox.style.fontSize = '24px';
        imgBox.style.display = 'flex';
        imgBox.style.alignItems = 'center';
        imgBox.style.justifyContent = 'center';
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'sprite-thumb-name';
      nameEl.textContent = s.name;

      div.appendChild(imgBox);
      div.appendChild(nameEl);
      div.addEventListener('click', () => selectSprite(s.id));
      list.appendChild(div);
    }

    updateSpriteProps();
  }

  function selectSprite(id) {
    Editor.saveCurrentCode();
    Engine.selectSprite(id);
    renderSpritePanel();
    const sp = Engine.getSelectedSprite();
    Editor.loadSprite(sp);
    CostumePanel.load(sp);
    updateSpriteProps();
  }

  // ── Properties bar ────────────────────────────────────────────
  function updateSpriteProps() {
    const sp      = Engine.getSelectedSprite();
    const propsEl = document.getElementById('sprite-props');
    const xEl     = document.getElementById('prop-x');
    const yEl     = document.getElementById('prop-y');
    const sizeEl  = document.getElementById('prop-size');
    const dirEl   = document.getElementById('prop-dir');
    const rotEl   = document.getElementById('prop-rotation');
    const xRow    = document.getElementById('prop-row-xy');
    const sizeRow = document.getElementById('prop-row-size');
    const rotRow  = document.getElementById('prop-row-rot');

    if (!sp) { propsEl.classList.add('hidden'); return; }
    propsEl.classList.remove('hidden');

    document.getElementById('prop-name').value = sp.name;

    const showPos = !sp.isStage;
    if (xRow)    xRow.style.display    = showPos ? '' : 'none';
    if (sizeRow) sizeRow.style.display = showPos ? '' : 'none';
    if (rotRow)  rotRow.style.display  = showPos ? '' : 'none';

    if (showPos) {
      xEl.value   = Math.round(sp.x);
      yEl.value   = Math.round(sp.y);
      sizeEl.value = sp.size;
      dirEl.value  = Math.round(sp.direction);
      rotEl.value  = sp.rotationMode;
      drawDirWheel(sp.direction);
    }
  }

  function onPropChange() {
    const sp = Engine.getSelectedSprite();
    if (!sp) return;

    const newName = document.getElementById('prop-name').value.trim();
    if (newName) sp.name = newName;

    if (!sp.isStage) {
      sp.x           = parseFloat(document.getElementById('prop-x').value)    || 0;
      sp.y           = parseFloat(document.getElementById('prop-y').value)    || 0;
      sp.size        = parseFloat(document.getElementById('prop-size').value) || 100;
      const newDir   = parseFloat(document.getElementById('prop-dir').value)  || 90;
      sp.direction   = ((newDir % 360) + 360) % 360;
      sp.rotationMode = document.getElementById('prop-rotation').value;
      drawDirWheel(sp.direction);
    }

    // Always refresh sprite panel so name/thumb stays in sync
    renderSpritePanel();
    Renderer.render();
  }

  // ── Direction wheel ───────────────────────────────────────────
  function initDirWheel() {
    const wc = document.getElementById('dir-wheel');
    let dragging = false;

    wc.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const rect = wc.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      // 0 = up, 90 = right  (spec direction convention)
      const angle   = Math.atan2(e.clientY - cy, e.clientX - cx);
      const deg     = Utils.radToDeg(angle) + 90; // shift so 0 = up
      const snapped = Math.round(deg / 5) * 5;
      const sp = Engine.getSelectedSprite();
      if (sp && !sp.isStage) {
        sp.direction = ((snapped % 360) + 360) % 360;
        document.getElementById('prop-dir').value = sp.direction;
        drawDirWheel(sp.direction);
        Renderer.render();
      }
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function drawDirWheel(direction) {
    const cv  = document.getElementById('dir-wheel');
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const cx = w / 2, cy = h / 2, r = w / 2 - 2;

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle   = '#13131a';
    ctx.fill();
    ctx.strokeStyle = '#333348';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // direction: 0=up, 90=right → canvas angle: 0=right, so subtract 90
    const rad = Utils.degToRad(direction - 90);
    const lx = cx + Math.cos(rad) * (r - 4);
    const ly = cy + Math.sin(rad) * (r - 4);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(lx, ly);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4ade80';
    ctx.fill();
  }

  // ── Canvas drag (editor mode only) ───────────────────────────
  function onCanvasMouseDown(e) {
    if (Engine.state.running) return;
    const canvas = document.getElementById('stage-canvas');
    const rect   = canvas.getBoundingClientRect();
    const sc     = canvas.offsetWidth / Renderer.STAGE_W;
    const px     = (e.clientX - rect.left) / sc - Renderer.STAGE_W / 2;
    const py     = -((e.clientY - rect.top)  / sc - Renderer.STAGE_H / 2);

    const sprites = Engine.getSortedSprites().slice().reverse();
    for (const sprite of sprites) {
      if (!sprite.visible) continue;
      if (Renderer.isPointInSprite(sprite, px, py)) {
        draggingSprite = sprite;
        dragOffsetX    = px - sprite.x;
        dragOffsetY    = py - sprite.y;
        Engine.selectSprite(sprite.id);
        renderSpritePanel();
        Editor.loadSprite(sprite);
        CostumePanel.load(sprite);
        break;
      }
    }
  }

  function onDocMouseMove(e) {
    if (!draggingSprite || Engine.state.running) return;
    const canvas = document.getElementById('stage-canvas');
    const rect   = canvas.getBoundingClientRect();
    const sc     = canvas.offsetWidth / Renderer.STAGE_W;
    const px     = (e.clientX - rect.left) / sc - Renderer.STAGE_W / 2;
    const py     = -((e.clientY - rect.top) / sc - Renderer.STAGE_H / 2);

    draggingSprite.x = Utils.clamp(px - dragOffsetX, -240, 240);
    draggingSprite.y = Utils.clamp(py - dragOffsetY, -180, 180);
    updateSpriteProps();
    Renderer.render();
  }

  // ── Variable monitors ─────────────────────────────────────────
  function updateVariableDisplay() {
    const container = document.getElementById('variable-display');
    container.innerHTML = '';

    for (const [, monitor] of Object.entries(Engine.state.variableMonitors)) {
      if (!monitor.visible) continue;
      const value = monitor.spriteId
        ? Engine.getSpriteVar(monitor.spriteId, monitor.name)
        : Engine.getGlobal(monitor.name);
      const el = document.createElement('div');
      el.className = 'variable-monitor';
      el.innerHTML = `<span class="var-name">${monitor.name}</span><span class="var-val">${value}</span>`;
      container.appendChild(el);
    }
  }

  // ── Fullscreen ────────────────────────────────────────────────
  function toggleFullscreen() {
    const area = document.getElementById('stage-area');
    area.classList.toggle('fullscreen');
    setTimeout(() => { Renderer.resize(); Renderer.render(); }, 50);
  }

  // ── Modal ─────────────────────────────────────────────────────
  function openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = bodyHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  return {
    init, renderSpritePanel, selectSprite, updateSpriteProps,
    updateVariableDisplay, openModal, closeModal,
  };
})();
