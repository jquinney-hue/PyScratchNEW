// collision.js — AABB Tree + pixel-mask collision detection
//
// ARCHITECTURE:
//   Each sprite has a CollisionShape derived from its current image:
//     - A pixel mask at reduced resolution (MASK_SCALE) storing which
//       pixels are non-transparent (alpha > threshold)
//     - A set of sub-AABBs built by recursively partitioning the mask
//       into an AABB tree.  Leaf nodes hold small blocks of pixels.
//
//   Collision between two sprites:
//     1. Broad phase: axis-aligned bounding box of the two sprites
//        in stage space — if they don't overlap, done.
//     2. Mid phase: AABB tree traversal — find pairs of leaf nodes
//        from each sprite whose world-space AABBs overlap.
//     3. Narrow phase: for each overlapping leaf pair, check whether
//        any pixel from sprite A overlaps an opaque pixel of sprite B
//        by sampling the OTHER sprite's mask at the transformed coords.
//
//   This is far more accurate than box collision and handles:
//     - Rotated sprites (all-around mode)
//     - Scaled sprites
//     - Per-pixel transparency
//
// MASK_SCALE controls the trade-off between accuracy and speed.
// At 0.25 a 100x100 sprite becomes a 25x25 mask — fast and accurate.

const Collision = (() => {
  const MASK_SCALE     = 0.25;  // downsample factor for pixel masks
  const ALPHA_THRESH   = 20;    // 0-255, pixels below this are transparent
  const MAX_LEAF_SIZE  = 4;     // leaf nodes cover at most NxN mask pixels

  // ── Shape cache ───────────────────────────────────────────────
  // Map of img.src → CollisionShape
  const _shapeCache = new Map();

  // A CollisionShape for one image (independent of sprite transform)
  class CollisionShape {
    constructor(img) {
      this.maskW  = 0;
      this.maskH  = 0;
      this.mask   = null;   // Uint8Array, 1=opaque 0=transparent
      this.tree   = null;   // root AABBNode in mask space
      this._build(img);
    }

    _build(img) {
      const w = img.naturalWidth  || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return;

      const mw = Math.max(1, Math.round(w * MASK_SCALE));
      const mh = Math.max(1, Math.round(h * MASK_SCALE));

      // Draw to offscreen canvas at reduced size
      const cv  = document.createElement('canvas');
      cv.width  = mw;
      cv.height = mh;
      const cx  = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, mw, mh);

      const data = cx.getImageData(0, 0, mw, mh).data;
      const mask = new Uint8Array(mw * mh);
      let hasAny = false;
      for (let i = 0; i < mw * mh; i++) {
        if (data[i * 4 + 3] >= ALPHA_THRESH) { mask[i] = 1; hasAny = true; }
      }

      this.maskW = mw;
      this.maskH = mh;
      this.mask  = mask;
      if (hasAny) this.tree = _buildTree(mask, mw, mh, 0, 0, mw, mh);
    }

    // Return true if mask pixel (mx, my) is opaque
    opaque(mx, my) {
      if (mx < 0 || my < 0 || mx >= this.maskW || my >= this.maskH) return false;
      return this.mask[my * this.maskW + mx] === 1;
    }
  }

  // A node in the AABB tree (in mask pixel space)
  class AABBNode {
    constructor(x, y, w, h) {
      this.x = x; this.y = y; this.w = w; this.h = h;
      this.left  = null;
      this.right = null;
      this.isLeaf = false;
    }
  }

  function _buildTree(mask, maskW, maskH, x, y, w, h) {
    // Cull empty regions
    if (!_hasOpaque(mask, maskW, x, y, w, h)) return null;

    const node = new AABBNode(x, y, w, h);

    if (w <= MAX_LEAF_SIZE && h <= MAX_LEAF_SIZE) {
      node.isLeaf = true;
      return node;
    }

    // Split along the longer axis
    if (w >= h) {
      const half = Math.floor(w / 2);
      node.left  = _buildTree(mask, maskW, x,        y, half,    h);
      node.right = _buildTree(mask, maskW, x + half, y, w - half, h);
    } else {
      const half = Math.floor(h / 2);
      node.left  = _buildTree(mask, maskW, x, y,        w, half);
      node.right = _buildTree(mask, maskW, x, y + half, w, h - half);
    }

    // If both children are null, this region is empty
    if (!node.left && !node.right) return null;
    return node;
  }

  function _hasOpaque(mask, maskW, x, y, w, h) {
    const x2 = Math.min(x + w, maskW);
    const y2 = Math.min(y + h, mask.length / maskW);
    for (let py = y; py < y2; py++) {
      for (let px = x; px < x2; px++) {
        if (mask[py * maskW + px]) return true;
      }
    }
    return false;
  }

  function _getShape(img) {
    if (!img) return null;
    const key = img.src || img._uid || (img._uid = Math.random().toString(36));
    if (!_shapeCache.has(key)) _shapeCache.set(key, new CollisionShape(img));
    return _shapeCache.get(key);
  }

  // Invalidate cache for an image (call when costume changes)
  function invalidate(img) {
    if (img) _shapeCache.delete(img.src);
  }

  // ── Transform helpers ─────────────────────────────────────────
  // Build a transform for a sprite: translate → rotate → scale
  // Returns functions to map between stage space and mask space.
  function _spriteTransform(sprite) {
    const scale  = sprite.size / 100;
    const img    = sprite._img;
    const imgW   = img ? (img.naturalWidth  || img.width)  : 40;
    const imgH   = img ? (img.naturalHeight || img.height) : 40;
    // Direction: 0=up, 90=right — canvas rotation: dir-90 degrees
    const radians = (sprite.rotationMode === 'none') ? 0
      : ((sprite.direction - 90) * Math.PI / 180);
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const cx  = sprite.x; // stage centre of sprite
    const cy  = sprite.y;

    // Stage → local image space (pixels, origin = top-left of image)
    function stageToImg(sx, sy) {
      // Translate to sprite centre
      let lx = sx - cx, ly = -(sy - cy); // flip y (stage y up, canvas y down)
      // Unrotate
      const ux = lx * cos + ly * sin;
      const uy = -lx * sin + ly * cos;
      // Unscale, offset to image top-left
      return {
        x: ux / scale + imgW / 2,
        y: uy / scale + imgH / 2,
      };
    }

    // Local image space → stage space
    function imgToStage(ix, iy) {
      const lx = (ix - imgW / 2) * scale;
      const ly = (iy - imgH / 2) * scale;
      const rx  = lx * cos - ly * sin;
      const ry  = lx * sin + ly * cos;
      return { x: cx + rx, y: cy - ry };
    }

    // Image coords → mask coords
    function imgToMask(ix, iy, shape) {
      return { x: ix * MASK_SCALE, y: iy * MASK_SCALE };
    }

    return { stageToImg, imgToStage, imgToMask, cos, sin, scale, cx, cy, imgW, imgH, radians };
  }

  // Get the world-space AABB of a sprite (accounts for rotation)
  function _worldAABB(sprite) {
    const img  = sprite._img;
    const imgW = img ? (img.naturalWidth  || img.width)  : 40;
    const imgH = img ? (img.naturalHeight || img.height) : 40;
    const s    = sprite.size / 100;
    const hw   = imgW * s / 2;
    const hh   = imgH * s / 2;

    if (sprite.rotationMode === 'none' || sprite.rotationMode === 'leftright') {
      // Axis-aligned — simple
      return { x: sprite.x - hw, y: sprite.y - hh, w: hw*2, h: hh*2 };
    }

    // Rotated — compute corners and take min/max
    const r   = (sprite.direction - 90) * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const corners = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (const [cx, cy] of corners) {
      const wx = sprite.x + cx*cos - cy*sin;
      const wy = sprite.y + cx*sin + cy*cos; // note: stage y+ is up
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
    }
    return { x: minX, y: minY, w: maxX-minX, h: maxY-minY };
  }

  function _aabbOverlap(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x ||
             a.y + a.h < b.y || b.y + b.h < a.y);
  }

  // Convert an AABBNode (mask space) to world space AABB for sprite
  function _nodeWorldAABB(node, tf) {
    // Node is in mask space. Convert corners to stage space.
    const { imgW, imgH, cos, sin, scale, cx: scx, cy: scy } = tf;
    // Mask → image: divide by MASK_SCALE
    const ix1 = node.x / MASK_SCALE;
    const iy1 = node.y / MASK_SCALE;
    const ix2 = (node.x + node.w) / MASK_SCALE;
    const iy2 = (node.y + node.h) / MASK_SCALE;

    const corners = [[ix1,iy1],[ix2,iy1],[ix2,iy2],[ix1,iy2]];
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (const [ix, iy] of corners) {
      const lx = (ix - imgW/2) * scale;
      const ly = (iy - imgH/2) * scale;
      const wx = scx + lx*cos - ly*sin;
      const wy = scy + lx*sin + ly*cos;
      if (wx<minX) minX=wx; if (wx>maxX) maxX=wx;
      if (wy<minY) minY=wy; if (wy>maxY) maxY=wy;
    }
    return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
  }

  // ── AABB tree traversal ───────────────────────────────────────
  // Collect all leaf pairs (nodeA, nodeB) whose world AABBs overlap
  function _findOverlappingLeaves(nodeA, tfA, nodeB, tfB, results) {
    if (!nodeA || !nodeB) return;

    const wA = _nodeWorldAABB(nodeA, tfA);
    const wB = _nodeWorldAABB(nodeB, tfB);
    if (!_aabbOverlap(wA, wB)) return;

    if (nodeA.isLeaf && nodeB.isLeaf) {
      results.push([nodeA, nodeB]);
      return;
    }

    // Expand the larger node
    if (!nodeA.isLeaf && (nodeB.isLeaf || nodeA.w * nodeA.h >= nodeB.w * nodeB.h)) {
      _findOverlappingLeaves(nodeA.left,  tfA, nodeB, tfB, results);
      _findOverlappingLeaves(nodeA.right, tfA, nodeB, tfB, results);
    } else {
      _findOverlappingLeaves(nodeA, tfA, nodeB.left,  tfB, results);
      _findOverlappingLeaves(nodeA, tfA, nodeB.right, tfB, results);
    }
  }

  // ── Narrow phase: pixel overlap test ─────────────────────────
  // For a leaf pair, check if any opaque pixel of A lands on an opaque pixel of B
  function _pixelOverlap(leafA, shapeA, tfA, leafB, shapeB, tfB) {
    // Iterate pixels of leafA in mask space, project to stage, then to B's mask
    const ax2 = Math.min(leafA.x + leafA.w, shapeA.maskW);
    const ay2 = Math.min(leafA.y + leafA.h, shapeA.maskH);

    for (let my = leafA.y; my < ay2; my++) {
      for (let mx = leafA.x; mx < ax2; mx++) {
        if (!shapeA.mask[my * shapeA.maskW + mx]) continue;

        // Mask A → image A coords
        const ix = mx / MASK_SCALE;
        const iy = my / MASK_SCALE;

        // Image A → stage coords
        const lx = (ix - tfA.imgW/2) * tfA.scale;
        const ly = (iy - tfA.imgH/2) * tfA.scale;
        const sx = tfA.cx + lx*tfA.cos - ly*tfA.sin;
        const sy = tfA.cy + lx*tfA.sin + ly*tfA.cos;

        // Stage → image B coords
        const { x: bix, y: biy } = tfB.stageToImg(sx, sy);

        // Image B → mask B coords
        const bmx = Math.round(bix * MASK_SCALE);
        const bmy = Math.round(biy * MASK_SCALE);

        if (shapeB.opaque(bmx, bmy)) return true;
      }
    }
    return false;
  }

  // ── Public API ────────────────────────────────────────────────

  // Full sprite-sprite collision test
  function spritesTouching(a, b) {
    if (!a.visible || !b.visible) return false;

    // 1. Broad phase: world AABB overlap
    if (!_aabbOverlap(_worldAABB(a), _worldAABB(b))) return false;

    const shapeA = _getShape(a._img);
    const shapeB = _getShape(b._img);

    // Fallback to AABB if no shape (emoji sprites, etc.)
    if (!shapeA || !shapeB || !shapeA.tree || !shapeB.tree) {
      return true; // broad phase already passed
    }

    const tfA = _spriteTransform(a);
    const tfB = _spriteTransform(b);

    // 2. Mid phase: AABB tree traversal
    const pairs = [];
    _findOverlappingLeaves(shapeA.tree, tfA, shapeB.tree, tfB, pairs);
    if (pairs.length === 0) return false;

    // 3. Narrow phase: pixel test on each overlapping leaf pair
    for (const [leafA, leafB] of pairs) {
      if (_pixelOverlap(leafA, shapeA, tfA, leafB, shapeB, tfB)) return true;
    }
    return false;
  }

  // Point-in-sprite test (e.g. for mouse click / touching("mouse_pointer"))
  function isPointInSprite(sprite, px, py) {
    if (!sprite.visible) return false;

    // Broad phase
    const aabb = _worldAABB(sprite);
    if (px < aabb.x || px > aabb.x + aabb.w ||
        py < aabb.y || py > aabb.y + aabb.h) return false;

    const shape = _getShape(sprite._img);
    if (!shape || !shape.mask) return true; // broad phase hit, no mask

    const tf    = _spriteTransform(sprite);
    const { x: ix, y: iy } = tf.stageToImg(px, py);
    const mx = Math.round(ix * MASK_SCALE);
    const my = Math.round(iy * MASK_SCALE);
    return shape.opaque(mx, my);
  }

  // Edge detection — unchanged (AABB is correct here)
  function spriteOnEdge(sprite, stageW, stageH) {
    const aabb = _worldAABB(sprite);
    return aabb.x            < -stageW / 2 ||
           aabb.x + aabb.w   >  stageW / 2 ||
           aabb.y            < -stageH / 2 ||
           aabb.y + aabb.h   >  stageH / 2;
  }

  return { spritesTouching, isPointInSprite, spriteOnEdge, invalidate };
})();
