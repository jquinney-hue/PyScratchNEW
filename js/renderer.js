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
    ctx    = canvas.getContext('2d', { willReadFrequently: true });
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

  // ── Main render ────────────────────────────────────────────────
  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);

    // Stage background
    const stage = Engine.state.stage;
    if (stage && stage._img) {
      ctx.drawImage(stage._img, 0, 0, STAGE_W, STAGE_H);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }

    // Sprites
    const sprites = Engine.getSortedSprites();
    for (const sp of sprites) {
      if (!sp.visible) continue;
      drawSprite(sp);
    }

    // Speech bubbles on top
    for (const sp of sprites) {
      if (sp._sayText) drawBubble(sp);
    }
  }

  function drawSprite(sprite) {
    const img = sprite._img;
    if (!img && !sprite._emoji) return;

    // Convert Scratch coords to canvas pixels
    // Scratch: origin=centre, +y=up   Canvas: origin=top-left, +y=down
    const cx = sprite.x + STAGE_W / 2;
    const cy = STAGE_H / 2 - sprite.y;
    const s  = sprite.size / 100;

    ctx.save();
    ctx.translate(cx, cy);

    if (sprite.rotationMode === 'all') {
      // direction: 0=up → rotate by (dir-90)° to align with canvas
      ctx.rotate(Utils.degToRad(sprite.direction - 90));
    } else if (sprite.rotationMode === 'leftright') {
      // Flip horizontally when direction points left (180°..360° i.e. negative x component)
      const rad = Utils.degToRad(sprite.direction - 90);
      if (Math.cos(rad) < 0) ctx.scale(-1, 1);
    }
    // 'none' — no rotation applied

    if (img) {
      const w = img.naturalWidth  * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      const sz = 40 * s;
      ctx.font = `${sz}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sprite._emoji || '❓', 0, 0);
    }

    ctx.restore();
  }

  function drawBubble(sprite) {
    const text = sprite._sayText;
    if (!text) return;

    const cx = sprite.x + STAGE_W / 2;
    const cy = STAGE_H / 2 - sprite.y;

    const padding  = 9;
    const maxWidth = 180;
    ctx.font = '12px sans-serif';

    // Word wrap
    const words = String(text).split(' ');
    const lines  = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else { line = test; }
    }
    if (line) lines.push(line);

    const lineH = 17;
    const bw = Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width))) + padding * 2;
    const bh = lines.length * lineH + padding * 2;

    // Position: above and to the right of the sprite centre
    const img = sprite._img;
    const sH  = img ? (img.naturalHeight * sprite.size / 100) : 40;
    const sW  = img ? (img.naturalWidth  * sprite.size / 100) : 40;

    let bx = cx + sW / 2 + 4;
    let by = cy - sH / 2 - bh - 4;

    if (bx + bw > STAGE_W - 2) bx = cx - sW / 2 - bw - 4;
    if (by < 2) by = cy + sH / 2 + 4;
    bx = Utils.clamp(bx, 2, STAGE_W - bw - 2);
    by = Utils.clamp(by, 2, STAGE_H - bh - 2);

    ctx.save();
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
    lines.forEach((l, i) => ctx.fillText(l, bx + padding, by + padding + i * lineH));
    ctx.restore();
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

  // ── Collision ──────────────────────────────────────────────────
  function isPointInSprite(sprite, px, py) {
    const img = sprite._img;
    const w   = (img ? img.naturalWidth  : 40) * (sprite.size / 100);
    const h   = (img ? img.naturalHeight : 40) * (sprite.size / 100);
    return px >= sprite.x - w / 2 && px <= sprite.x + w / 2 &&
           py >= sprite.y - h / 2 && py <= sprite.y + h / 2;
  }

  function spritesTouching(a, b) {
    if (!a.visible || !b.visible) return false;
    const aImg = a._img, bImg = b._img;
    const aw = (aImg ? aImg.naturalWidth  : 40) * (a.size / 100) / 2;
    const ah = (aImg ? aImg.naturalHeight : 40) * (a.size / 100) / 2;
    const bw = (bImg ? bImg.naturalWidth  : 40) * (b.size / 100) / 2;
    const bh = (bImg ? bImg.naturalHeight : 40) * (b.size / 100) / 2;
    return !(a.x + aw < b.x - bw || a.x - aw > b.x + bw ||
             a.y + ah < b.y - bh || a.y - ah > b.y + bh);
  }

  function spriteOnEdge(sprite) {
    const img = sprite._img;
    const hw = (img ? img.naturalWidth  : 40) * (sprite.size / 100) / 2;
    const hh = (img ? img.naturalHeight : 40) * (sprite.size / 100) / 2;
    return sprite.x + hw >  STAGE_W / 2 ||
           sprite.x - hw < -STAGE_W / 2 ||
           sprite.y + hh >  STAGE_H / 2 ||
           sprite.y - hh < -STAGE_H / 2;
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
    if (!costume || !costume.url) {
      sprite._img   = null;
      sprite._emoji = sprite.isStage ? null : '🐱';
      return;
    }
    const img = await loadImage(costume.url);
    sprite._img   = img;
    sprite._emoji = img ? null : '❓';
  }

  return {
    STAGE_W, STAGE_H,
    init, resize, render,
    loadImage, loadSpriteImage,
    isPointInSprite, spritesTouching, spriteOnEdge, bounceOffEdge,
    get mouseX()   { return mouseX; },
    get mouseY()   { return mouseY; },
    get mouseDown(){ return mouseDown; },
    get scale()    { return _scale; },
  };
})();
