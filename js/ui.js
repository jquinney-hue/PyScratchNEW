// ui.js — sprite panel, properties, variable display

const UI = (() => {
  let draggingSprite = null;
  let dragOffsetX = 0, dragOffsetY = 0;

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    // Sprite list buttons
    document.getElementById('btn-add-sprite').addEventListener('click', addSprite);
    document.getElementById('btn-delete-sprite').addEventListener('click', deleteSprite);

    // Property inputs
    document.getElementById('prop-name').addEventListener('change', onPropChange);
    document.getElementById('prop-x').addEventListener('change', onPropChange);
    document.getElementById('prop-y').addEventListener('change', onPropChange);
    document.getElementById('prop-size').addEventListener('change', onPropChange);
    document.getElementById('prop-dir').addEventListener('change', onPropChange);
    document.getElementById('prop-rotation').addEventListener('change', onPropChange);

    // Direction wheel
    initDirWheel();

    // Canvas drag
    const canvas = document.getElementById('stage-canvas');
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', () => { draggingSprite = null; });

    // Fullscreen
    document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

    // Variable display updater
    Engine.setVariableUpdateCallback(updateVariableDisplay);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ── Sprite management ─────────────────────────────────────────
  async function addSprite() {
    const sprite = Engine.addSprite({
      costumes: [{ name: 'default', url: '', emoji: '🐱' }]
    });
    sprite.threads = [{ id: Utils.uid(), name: 'main', code: '' }];
    await Renderer.loadSpriteImage(sprite);
    Engine.selectSprite(sprite.id);
    renderSpritePanel();
    Editor.loadSprite(sprite);
    CostumePanel.load(sprite);
  }

  function deleteSprite() {
    const sel = Engine.getSelectedSprite();
    if (!sel || sel.id === 'stage') {
      alert('Cannot delete the stage.');
      return;
    }
    if (!confirm(`Delete "${sel.name}"?`)) return;
    Engine.deleteSprite(sel.id);
    const next = Engine.state.stage;
    Engine.selectSprite(next.id);
    renderSpritePanel();
    Editor.loadSprite(next);
    CostumePanel.load(next);
    Renderer.render();
  }

  // ── Sprite panel rendering ────────────────────────────────────
  function renderSpritePanel() {
    const list = document.getElementById('sprite-list');
    const allTargets = [Engine.state.stage, ...Engine.getAllSprites()];
    const selected = Engine.state.selectedSpriteId;

    list.innerHTML = '';
    for (const s of allTargets) {
      const div = document.createElement('div');
      div.className = 'sprite-thumb' + (s.id === selected ? ' active' : '');
      div.dataset.spriteId = s.id;

      const imgBox = document.createElement('div');
      imgBox.className = 'sprite-thumb-img';

      if (s._img) {
        const img = document.createElement('img');
        img.src = s._img.src;
        imgBox.appendChild(img);
      } else {
        imgBox.textContent = s._emoji || (s.isStage ? '🎬' : '🐱');
      }

      const name = document.createElement('div');
      name.className = 'sprite-thumb-name';
      name.textContent = s.name;

      div.appendChild(imgBox);
      div.appendChild(name);
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

  // ── Properties ────────────────────────────────────────────────
  function updateSpriteProps() {
    const sp = Engine.getSelectedSprite();
    const propsEl = document.getElementById('sprite-props');

    if (!sp) { propsEl.classList.add('hidden'); return; }
    propsEl.classList.remove('hidden');

    document.getElementById('prop-name').value = sp.name;
    if (!sp.isStage) {
      document.getElementById('prop-x').value = Math.round(sp.x);
      document.getElementById('prop-y').value = Math.round(sp.y);
      document.getElementById('prop-size').value = sp.size;
      document.getElementById('prop-dir').value = Math.round(sp.direction);
      document.getElementById('prop-rotation').value = sp.rotationMode;
    }
    drawDirWheel(sp.direction);
  }

  function onPropChange() {
    const sp = Engine.getSelectedSprite();
    if (!sp) return;

    const newName = document.getElementById('prop-name').value.trim();
    if (newName) sp.name = newName;

    if (!sp.isStage) {
      sp.x = parseFloat(document.getElementById('prop-x').value) || 0;
      sp.y = parseFloat(document.getElementById('prop-y').value) || 0;
      sp.size = parseFloat(document.getElementById('prop-size').value) || 100;
      sp.direction = parseFloat(document.getElementById('prop-dir').value) || 90;
      sp.rotationMode = document.getElementById('prop-rotation').value;
    }

    renderSpritePanel();
    drawDirWheel(sp.direction);
    Renderer.render();
  }

  // ── Direction wheel ───────────────────────────────────────────
  function initDirWheel() {
    const wc = document.getElementById('dir-wheel');
    let dragging = false;

    wc.addEventListener('mousedown', (e) => {
      dragging = true;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = wc.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
      const deg = Math.round(Utils.radToDeg(angle) + 90);
      const snapped = Math.round(deg / 5) * 5;
      const sp = Engine.getSelectedSprite();
      if (sp) {
        sp.direction = ((snapped % 360) + 360) % 360;
        document.getElementById('prop-dir').value = sp.direction;
        drawDirWheel(sp.direction);
      }
    });

    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function drawDirWheel(direction) {
    const canvas = document.getElementById('dir-wheel');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, r = w / 2 - 2;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#13131a';
    ctx.fill();
    ctx.strokeStyle = '#333348';
    ctx.lineWidth = 1;
    ctx.stroke();

    const rad = Utils.scratchDirToRad(direction);
    const lx = cx + Math.cos(rad) * (r - 4);
    const ly = cy + Math.sin(rad) * (r - 4);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(lx, ly);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4ade80';
    ctx.fill();
  }

  // ── Canvas dragging ───────────────────────────────────────────
  function onCanvasMouseDown(e) {
    if (Engine.state.running) return;
    const canvas = document.getElementById('stage-canvas');
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.offsetWidth / Renderer.STAGE_W;
    const px = (e.clientX - rect.left) / scale - Renderer.STAGE_W / 2;
    const py = -(( e.clientY - rect.top) / scale - Renderer.STAGE_H / 2);

    const sprites = Engine.getSortedSprites().reverse();
    for (const sprite of sprites) {
      if (!sprite.visible) continue;
      if (Renderer.isPointInSprite(sprite, px, py)) {
        draggingSprite = sprite;
        dragOffsetX = px - sprite.x;
        dragOffsetY = py - sprite.y;
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
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.offsetWidth / Renderer.STAGE_W;
    const px = (e.clientX - rect.left) / scale - Renderer.STAGE_W / 2;
    const py = -((e.clientY - rect.top) / scale - Renderer.STAGE_H / 2);

    draggingSprite.x = Utils.clamp(px - dragOffsetX, -240, 240);
    draggingSprite.y = Utils.clamp(py - dragOffsetY, -180, 180);
    updateSpriteProps();
    Renderer.render();
  }

  // ── Variable display ──────────────────────────────────────────
  function updateVariableDisplay() {
    const container = document.getElementById('variable-display');
    container.innerHTML = '';

    for (const [key, monitor] of Object.entries(Engine.state.variableMonitors)) {
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
    setTimeout(() => Renderer.resize(), 50);
  }

  // ── Modal ─────────────────────────────────────────────────────
  function openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  return {
    init,
    renderSpritePanel,
    selectSprite,
    updateSpriteProps,
    updateVariableDisplay,
    openModal,
    closeModal,
  };
})();
