// renderer.js — canvas rendering engine

const Renderer = (() => {
  const STAGE_W = 480;
  const STAGE_H = 360;

  let canvas, ctx;
  let scale = 1;
  let mouseX = 0, mouseY = 0;
  let mouseDown = false;

  // Speech bubbles: spriteId -> { text, timer }
  const bubbles = {};

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', () => { mouseDown = true; });
    canvas.addEventListener('mouseup', () => { mouseDown = false; });
    canvas.addEventListener('click', onCanvasClick);
  }

  function resize() {
    const container = canvas.parentElement;
    const area = container.parentElement;
    const maxW = area.clientWidth - 2;
    const maxH = area.clientHeight - 30; // minus controls
    const scaleW = maxW / STAGE_W;
    const scaleH = maxH / STAGE_H;
    scale = Math.min(scaleW, scaleH, 2);

    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    canvas.style.width = (STAGE_W * scale) + 'px';
    canvas.style.height = (STAGE_H * scale) + 'px';
  }

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    mouseX = px - STAGE_W / 2;
    mouseY = -(py - STAGE_H / 2);
    document.getElementById('mouse-coords').textContent =
      `x: ${Math.round(mouseX)}, y: ${Math.round(mouseY)}`;
  }

  function onCanvasClick(e) {
    if (!Engine.state.running) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    const mx = px - STAGE_W / 2;
    const my = -(py - STAGE_H / 2);

    // Fire click events for sprites under cursor
    const sprites = Engine.getSortedSprites().reverse();
    for (const sprite of sprites) {
      if (!sprite.visible) continue;
      if (isPointInSprite(sprite, mx, my)) {
        Scheduler.fireEvent('click', sprite.id);
      }
    }
    Scheduler.fireEvent('stage_click', 'stage');
  }

  function isPointInSprite(sprite, px, py) {
    const img = sprite._img;
    if (!img) return false;
    const w = (img.width || 40) * (sprite.size / 100);
    const h = (img.height || 40) * (sprite.size / 100);
    return (
      px >= sprite.x - w / 2 &&
      px <= sprite.x + w / 2 &&
      py >= sprite.y - h / 2 &&
      py <= sprite.y + h / 2
    );
  }

  // ── Main render ───────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);

    // Draw stage backdrop
    const stage = Engine.state.stage;
    if (stage._img) {
      ctx.drawImage(stage._img, 0, 0, STAGE_W, STAGE_H);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }

    // Draw sprites in layer order
    const sprites = Engine.getSortedSprites();
    for (const sprite of sprites) {
      if (!sprite.visible) continue;
      drawSprite(sprite);
    }

    // Draw speech bubbles
    for (const sprite of sprites) {
      if (sprite._sayText) {
        drawBubble(sprite);
      }
    }
  }

  function drawSprite(sprite) {
    const img = sprite._img;
    if (!img && !sprite._emoji) return;

    const sx = sprite.x + STAGE_W / 2;
    const sy = STAGE_H / 2 - sprite.y;
    const scale_s = sprite.size / 100;

    ctx.save();
    ctx.translate(sx, sy);

    // Rotation based on rotationMode
    if (sprite.rotationMode === 'all') {
      ctx.rotate(Utils.scratchDirToRad(sprite.direction));
    } else if (sprite.rotationMode === 'leftright') {
      if (sprite.direction < 0 || (sprite.direction > 180 && sprite.direction <= 360)) {
        ctx.scale(-1, 1);
      }
    }

    if (img) {
      const w = img.width * scale_s;
      const h = img.height * scale_s;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      // Emoji fallback
      const size = 40 * scale_s;
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sprite._emoji || '❓', 0, 0);
    }

    ctx.restore();
  }

  function drawBubble(sprite) {
    const text = sprite._sayText;
    if (!text) return;

    const sx = sprite.x + STAGE_W / 2;
    const sy = STAGE_H / 2 - sprite.y;

    const padding = 8;
    const maxWidth = 180;
    ctx.font = '12px Syne, sans-serif';

    // Word wrap
    const words = String(text).split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    const lineH = 16;
    const bw = Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width))) + padding * 2;
    const bh = lines.length * lineH + padding * 2;

    // Position above sprite
    const img = sprite._img;
    const sH = img ? img.height * (sprite.size / 100) : 40;
    let bx = sx + 10;
    let by = sy - sH / 2 - bh - 10;

    // Keep in bounds
    if (bx + bw > STAGE_W) bx = sx - bw - 10;
    if (by < 0) by = sy + sH / 2 + 10;
    bx = Utils.clamp(bx, 2, STAGE_W - bw - 2);

    ctx.save();
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#222';
    ctx.font = '12px Syne, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, bx + padding, by + padding + i * lineH);
    });
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
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

  // ── Collision ─────────────────────────────────────────────────
  function spritesTouching(spriteA, spriteB) {
    if (!spriteA.visible || !spriteB.visible) return false;
    // AABB first pass
    const aImg = spriteA._img;
    const bImg = spriteB._img;
    const aw = (aImg ? aImg.width : 40) * (spriteA.size / 100);
    const ah = (aImg ? aImg.height : 40) * (spriteA.size / 100);
    const bw = (bImg ? bImg.width : 40) * (spriteB.size / 100);
    const bh = (bImg ? bImg.height : 40) * (spriteB.size / 100);

    return !(
      spriteA.x + aw / 2 < spriteB.x - bw / 2 ||
      spriteA.x - aw / 2 > spriteB.x + bw / 2 ||
      spriteA.y + ah / 2 < spriteB.y - bh / 2 ||
      spriteA.y - ah / 2 > spriteB.y + bh / 2
    );
  }

  function spriteOnEdge(sprite) {
    const img = sprite._img;
    const w = (img ? img.width : 40) * (sprite.size / 100);
    const h = (img ? img.height : 40) * (sprite.size / 100);
    return (
      sprite.x + w / 2 >= STAGE_W / 2 ||
      sprite.x - w / 2 <= -STAGE_W / 2 ||
      sprite.y + h / 2 >= STAGE_H / 2 ||
      sprite.y - h / 2 <= -STAGE_H / 2
    );
  }

  function bounceOffEdge(sprite) {
    const img = sprite._img;
    const w = (img ? img.width : 40) * (sprite.size / 100);
    const h = (img ? img.height : 40) * (sprite.size / 100);

    const rad = Utils.scratchDirToRad(sprite.direction);
    let dx = Math.cos(rad);
    let dy = -Math.sin(rad);

    if (sprite.x + w / 2 >= STAGE_W / 2 || sprite.x - w / 2 <= -STAGE_W / 2) dx = -dx;
    if (sprite.y + h / 2 >= STAGE_H / 2 || sprite.y - h / 2 <= -STAGE_H / 2) dy = -dy;

    sprite.direction = Utils.radToDeg(Math.atan2(-dy, dx)) + 90;
    sprite.direction = ((sprite.direction % 360) + 360) % 360;

    // Push back into bounds
    sprite.x = Utils.clamp(sprite.x, -(STAGE_W / 2 - w / 2), STAGE_W / 2 - w / 2);
    sprite.y = Utils.clamp(sprite.y, -(STAGE_H / 2 - h / 2), STAGE_H / 2 - h / 2);
  }

  // ── Load image ────────────────────────────────────────────────
  function loadImage(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function loadSpriteImage(sprite) {
    const costume = sprite.costumes[sprite.currentCostume];
    if (!costume) { sprite._img = null; sprite._emoji = sprite.id === 'stage' ? null : '🐱'; return; }
    if (costume.url) {
      const img = await loadImage(costume.url);
      sprite._img = img;
      sprite._emoji = img ? null : '❓';
    } else {
      sprite._img = null;
      sprite._emoji = costume.emoji || '🐱';
    }
  }

  return {
    STAGE_W,
    STAGE_H,
    init,
    resize,
    render,
    loadImage,
    loadSpriteImage,
    spritesTouching,
    spriteOnEdge,
    bounceOffEdge,
    isPointInSprite,
    get mouseX() { return mouseX; },
    get mouseY() { return mouseY; },
    get mouseDown() { return mouseDown; },
  };
})();
