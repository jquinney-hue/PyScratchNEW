// renderer.js — canvas rendering engine

const Renderer = (() => {
  const STAGE_W = 480;
  const STAGE_H = 360;

  let canvas, ctx;
  let _scale = 1;
  let mouseX = 0, mouseY = 0;
  let mouseDown = false;

  // ── Init ──────────────────────────────────────────────────────
  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d'); // no willReadFrequently — keeps GPU acceleration
    resize();
    window.addEventListener('resize', () => { resize(); render(); });

    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mousedown',  () => { mouseDown = true; });
    canvas.addEventListener('mouseup',    () => { mouseDown = false; });
    canvas.addEventListener('mouseleave', () => { mouseDown = false; });
    canvas.addEventListener('click',      onCanvasClick);
  }

  function resize() {
    const area = canvas.closest('#stage-area');
    if (!area) return;
    const maxW = area.clientWidth;
    const maxH = area.clientHeight - 28; // minus stage-controls bar
    const scaleW = maxW  / STAGE_W;
    const scaleH = maxH  / STAGE_H;
    _scale = Math.min(scaleW, scaleH, 2);
    if (_scale <= 0) _scale = 1;

    canvas.width  = STAGE_W;
    canvas.height = STAGE_H;
    canvas.style.width  = Math.floor(STAGE_W * _scale) + 'px';
    canvas.style.height = Math.floor(STAGE_H * _scale) + 'px';
  }

  function getScale() { return _scale; }

  // ── Mouse ──────────────────────────────────────────────────────
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouseX =  (e.clientX - rect.left)  / _scale - STAGE_W / 2;
    mouseY = -((e.clientY - rect.top)  / _scale - STAGE_H / 2);
    const coordEl = document.getElementById('mouse-coords');
    if (coordEl) coordEl.textContent = `x: ${Math.round(mouseX)}, y: ${Math.round(mouseY)}`;
  }

  function onCanvasClick(e) {
    if (!Engine.state.running) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / _scale - STAGE_W / 2;
    const cy = -((e.clientY - rect.top) / _scale - STAGE_H / 2);

    const sprites = Engine.getSortedSprites().slice().reverse();
    for (const sprite of sprites) {
      if (!sprite.visible) continue;
      if (isPointInSprite(sprite, cx, cy)) {
        Scheduler.fireEvent('click', sprite.id);
      }
    }
    Scheduler.fireEvent('stage_click', 'stage');
  }

  // Cached sorted sprite list — rebuilt only when sprite count or layers change
  let _sortedCache = [];
  let _sortedDirty = true;
  function markSortDirty() { _sortedDirty = true; }

  function _getSorted() {
    if (_sortedDirty) {
      _sortedCache = Engine.getSortedSprites();
      _sortedDirty = false;
    }
    return _sortedCache;
  }

  // ── Main render ────────────────────────────────────────────────
  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);

    const stage = Engine.state.stage;
    if (stage && stage._img) {
      ctx.drawImage(stage._img, 0, 0, STAGE_W, STAGE_H);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }

    const sprites = _getSorted();
    let hasBubbles = false;
    for (let i = 0; i < sprites.length; i++) {
      const sp = sprites[i];
      if (!sp.visible) continue;
      drawSprite(sp);
      if (sp._sayText) hasBubbles = true;
    }

    if (hasBubbles) {
      for (let i = 0; i < sprites.length; i++) {
        if (sprites[i]._sayText) drawBubble(sprites[i]);
      }
    }
  }

  function drawSprite(sprite) {
    const img = sprite._img;
    if (!img && !sprite._emoji) return;

    const cx = sprite.x + STAGE_W / 2;
    const cy = STAGE_H / 2 - sprite.y;
    const s  = sprite.size / 100;
    const rm = sprite.rotationMode;

    if (img) {
      const w = img.naturalWidth  * s;
      const h = img.naturalHeight * s;

      if (rm === 'none') {
        // Fast path: no transform needed — single drawImage call, no save/restore
        ctx.drawImage(img, cx - w * 0.5, cy - h * 0.5, w, h);
      } else if (rm === 'leftright') {
        // Only flip, no rotate — cheap transform
        const rad = (sprite.direction - 90) * 0.017453292519943295;
        if (Math.cos(rad) < 0) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
          ctx.restore();
        } else {
          ctx.drawImage(img, cx - w * 0.5, cy - h * 0.5, w, h);
        }
      } else {
        // Full rotation
        const rad = (sprite.direction - 90) * 0.017453292519943295;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rad);
        ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
        ctx.restore();
      }
    } else {
      const sz = 40 * s;
      ctx.font = sz + 'px serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sprite._emoji || '❓', cx, cy);
    }
  }

  // Bubble layout cache — recompute only when text changes
  const _bubbleCache = new Map(); // spriteId -> { text, lines, bw, bh }

  function drawBubble(sprite) {
    const text = sprite._sayText;
    if (!text) return;

    const cx = sprite.x + STAGE_W / 2;
    const cy = STAGE_H / 2 - sprite.y;

    const PADDING = 9, MAX_W = 180, LINE_H = 17;

    // Recompute layout only when text changes
    let layout = _bubbleCache.get(sprite.id);
    if (!layout || layout.text !== text) {
      ctx.font = '12px sans-serif';
      const words = String(text).split(' ');
      const lines = [];
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > MAX_W && line) { lines.push(line); line = word; }
        else line = test;
      }
      if (line) lines.push(line);
      const bw = Math.min(MAX_W, Math.max(...lines.map(l => ctx.measureText(l).width))) + PADDING * 2;
      const bh = lines.length * LINE_H + PADDING * 2;
      layout = { text, lines, bw, bh };
      _bubbleCache.set(sprite.id, layout);
    }

    const { lines, bw, bh } = layout;
    const img = sprite._img;
    const sH  = img ? (img.naturalHeight * sprite.size / 100) : 40;
    const sW  = img ? (img.naturalWidth  * sprite.size / 100) : 40;

    let bx = cx + sW * 0.5 + 4;
    let by = cy - sH * 0.5 - bh - 4;
    if (bx + bw > STAGE_W - 2) bx = cx - sW * 0.5 - bw - 4;
    if (by < 2) by = cy + sH * 0.5 + 4;
    bx = Utils.clamp(bx, 2, STAGE_W - bw - 2);
    by = Utils.clamp(by, 2, STAGE_H - bh - 2);

    ctx.fillStyle   = 'white';
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth   = 1.5;
    _roundRect(ctx, bx, by, bw, bh, 7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle    = '#222';
    ctx.font         = '12px sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + PADDING, by + PADDING + i * LINE_H);
    }
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── Collision — delegated to Collision module ─────────────────
  // Collision.js implements AABB tree + pixel-mask narrow phase.
  function isPointInSprite(sprite, px, py) {
    return Collision.isPointInSprite(sprite, px, py);
  }

  function spritesTouching(a, b) {
    return Collision.spritesTouching(a, b);
  }

  function spriteOnEdge(sprite) {
    return Collision.spriteOnEdge(sprite, STAGE_W, STAGE_H);
  }

  function bounceOffEdge(sprite) {
    const img = sprite._img;
    const hw = (img ? img.naturalWidth  : 40) * (sprite.size / 100) / 2;
    const hh = (img ? img.naturalHeight : 40) * (sprite.size / 100) / 2;

    // direction: 0=up, 90=right → convert to standard math angle for dx/dy
    const rad = Utils.degToRad(sprite.direction - 90);
    let dx =  Math.cos(rad); // right component
    let dy = -Math.sin(rad); // up component (canvas y is inverted)

    if (sprite.x + hw >= STAGE_W / 2 || sprite.x - hw <= -STAGE_W / 2) dx = -dx;
    if (sprite.y + hh >= STAGE_H / 2 || sprite.y - hh <= -STAGE_H / 2) dy = -dy;

    // Convert back to Scratch direction
    // math angle: atan2(dy, dx) → scratch dir = math + 90
    sprite.direction = (Utils.radToDeg(Math.atan2(-dy, dx)) + 90 + 360) % 360;

    // Clamp position so sprite is fully inside
    sprite.x = Utils.clamp(sprite.x, -STAGE_W / 2 + hw, STAGE_W / 2 - hw);
    sprite.y = Utils.clamp(sprite.y, -STAGE_H / 2 + hh, STAGE_H / 2 - hh);
  }

  // ── Image loading ──────────────────────────────────────────────
  const _imgCache = {};

  function loadImage(url) {
    if (_imgCache[url]) return Promise.resolve(_imgCache[url]);
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { _imgCache[url] = img; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function loadSpriteImage(sprite) {
    const costume = sprite.costumes[sprite.currentCostume];
    // Invalidate old collision shape before replacing image
    if (sprite._img) Collision.invalidate(sprite._img);
    if (!costume || !costume.url) {
      sprite._img   = null;
      sprite._emoji = sprite.isStage ? null : '🐱';
      return;
    }
    const img = await loadImage(costume.url);
    sprite._img   = img;
    sprite._emoji = img ? null : '❓';
    // Pre-warm the collision shape cache in the background
    if (img) requestIdleCallback
      ? requestIdleCallback(() => Collision.isPointInSprite(sprite, -9999, -9999))
      : setTimeout(() => Collision.isPointInSprite(sprite, -9999, -9999), 100);
  }

  return {
    STAGE_W, STAGE_H,
    init, resize, render, markSortDirty,
    loadImage, loadSpriteImage,
    isPointInSprite, spritesTouching, spriteOnEdge, bounceOffEdge,
    get mouseX()   { return mouseX; },
    get mouseY()   { return mouseY; },
    get mouseDown(){ return mouseDown; },
    get scale()    { return _scale; },
  };
})();
