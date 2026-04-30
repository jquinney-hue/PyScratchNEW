// costumes.js — costume panel and library browser

const CostumePanel = (() => {
  const SPRITE_LIB_URL  = 'https://raw.githubusercontent.com/jquinney-hue/pyscratchurls.github.io/refs/heads/main/costumeurls.txt';
  const STAGE_LIB_URL   = 'https://raw.githubusercontent.com/jquinney-hue/pyscratchurls.github.io/refs/heads/main/backdropurls.txt';

  let cachedSpriteUrls   = null;
  let cachedBackdropUrls = null;
  let _currentSprite     = null; // track which sprite the panel is showing

  // ── Preload library lists on startup ─────────────────────────
  async function preload() {
    try {
      const [s, b] = await Promise.all([
        Utils.fetchText(SPRITE_LIB_URL),
        Utils.fetchText(STAGE_LIB_URL),
      ]);
      if (s) cachedSpriteUrls   = parseUrlList(s, 'Costume');
      if (b) cachedBackdropUrls = parseUrlList(b, 'Backdrop');
    } catch (e) {
      console.warn('Could not preload costume library URLs', e);
    }
  }

  function parseUrlList(text, prefix) {
    // Each line is a partial URL — append /get/ if the URL has no file extension
    // (Some lines already end in /get/)
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map((rawUrl, i) => {
        const url = resolveLibUrl(rawUrl);
        // Derive a readable name from the last path segment before /get/
        const clean = rawUrl.replace(/\/get\/?$/, '');
        const seg   = clean.split('/').pop() || '';
        const name  = seg.replace(/\.\w{2,5}$/, '').replace(/[_-]/g, ' ') || `${prefix} ${i + 1}`;
        return { url, name };
      });
  }

  function resolveLibUrl(url) {
    // The txt file lines are missing /get/ — add it unless already present
    if (url.endsWith('/get/') || url.endsWith('/get')) return url;
    return url.endsWith('/') ? url + 'get/' : url + '/get/';
  }

  // ── Load a sprite/stage into the costume panel ────────────────
  function load(sprite) {
    _currentSprite = sprite;
    if (!sprite) { renderEmpty(); return; }
    document.getElementById('costume-panel-title').textContent =
      sprite.isStage ? 'Backdrops' : 'Costumes';
    renderList(sprite);
  }

  function renderEmpty() {
    document.getElementById('costume-list').innerHTML =
      '<div style="color:var(--text-muted);padding:12px;font-size:12px;">Select a sprite</div>';
  }

  // ── Render the costume list for a sprite ─────────────────────
  function renderList(sprite) {
    const list = document.getElementById('costume-list');
    list.innerHTML = '';

    if (sprite.costumes.length === 0) {
      list.innerHTML = '<div class="costume-empty">No costumes yet.<br>Click <strong>+ Add</strong> above to add one.</div>';
      return;
    }

    sprite.costumes.forEach((costume, i) => {
      const isActive = i === sprite.currentCostume;
      const item = document.createElement('div');
      item.className = 'costume-item' + (isActive ? ' active' : '');
      item.dataset.index = i;

      // Thumbnail
      const thumb = document.createElement('div');
      thumb.className = 'costume-thumb-img';
      if (costume.url) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.style.cssText = 'width:48px;height:48px;object-fit:contain;';
        img.src = costume.url;
        img.onerror = () => thumb.appendChild(makeFallbackEmoji());
        thumb.appendChild(img);
      } else {
        thumb.appendChild(makeFallbackEmoji());
      }

      // Info column — name + active badge
      const info = document.createElement('div');
      info.className = 'costume-item-info';

      const nameEl = document.createElement('input');
      nameEl.type = 'text';
      nameEl.className = 'costume-name-input';
      nameEl.value = costume.name;
      nameEl.addEventListener('change', () => { costume.name = nameEl.value.trim() || costume.name; });
      nameEl.addEventListener('click', e => e.stopPropagation());

      const badge = document.createElement('div');
      badge.className = 'costume-active-badge';
      badge.textContent = 'Active';

      info.appendChild(nameEl);
      info.appendChild(badge);

      // Delete button
      const del = document.createElement('button');
      del.className = 'costume-delete-btn';
      del.title = 'Delete costume';
      del.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
      del.addEventListener('click', e => {
        e.stopPropagation();
        if (sprite.costumes.length <= 1) { alert('A sprite must have at least one costume.'); return; }
        sprite.costumes.splice(i, 1);
        if (sprite.currentCostume >= sprite.costumes.length) sprite.currentCostume = sprite.costumes.length - 1;
        _afterCostumeChange(sprite);
      });

      item.appendChild(thumb);
      item.appendChild(info);
      item.appendChild(del);

      item.addEventListener('click', () => {
        sprite.currentCostume = i;
        _afterCostumeChange(sprite);
      });

      list.appendChild(item);
    });
  }

  function makeFallbackEmoji() {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:24px;display:flex;align-items:center;justify-content:center;width:36px;height:36px;';
    span.textContent = '🐱';
    return span;
  }

  // ── After any costume mutation: reload image + refresh all UI ─
  async function _afterCostumeChange(sprite) {
    await Renderer.loadSpriteImage(sprite);
    renderList(sprite);           // refresh costume panel
    UI.renderSpritePanel();       // refresh sprite thumb in bottom panel
    Renderer.render();            // refresh canvas
  }

  // ── Show add options: URL input or library browser ────────────
  function showAddOptions(sprite) {
    const isStage = !!sprite.isStage;
    const prefix  = isStage ? 'Backdrop' : 'Costume';
    const nextNum = sprite.costumes.length + 1;

    const html = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px;">Paste image URL</label>
          <div style="display:flex;gap:6px;">
            <input type="text" id="add-costume-url" placeholder="https://..." style="flex:1;padding:6px 8px;" />
            <button class="btn btn-sm btn-accent" id="add-costume-url-btn">Add</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">PNG or SVG. /get/ will be added if needed.</div>
        </div>
        <div>
          <button class="btn btn-sm btn-ghost" id="add-costume-library-btn" style="width:100%;">
            📁 Browse ${isStage ? 'Backdrop' : 'Costume'} Library
          </button>
        </div>
      </div>`;

    UI.openModal(`Add ${prefix}`, html);

    document.getElementById('add-costume-url-btn').addEventListener('click', async () => {
      const url = document.getElementById('add-costume-url').value.trim();
      if (!url) return;
      const resolved = resolveLibUrl(url);
      const name = `${prefix} ${nextNum}`;
      sprite.costumes.push({ name, url: resolved });
      sprite.currentCostume = sprite.costumes.length - 1;
      UI.closeModal();
      await _afterCostumeChange(sprite);
    });

    document.getElementById('add-costume-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('add-costume-url-btn').click();
    });

    document.getElementById('add-costume-library-btn').addEventListener('click', () => {
      UI.closeModal();
      openLibraryBrowser(sprite);
    });
  }

  // ── Library browser modal ─────────────────────────────────────
  function openLibraryBrowser(sprite) {
    const isStage = !!sprite.isStage;
    const urls    = isStage ? cachedBackdropUrls : cachedSpriteUrls;
    const prefix  = isStage ? 'Backdrop' : 'Costume';
    const title   = `${prefix} Library`;
    const nextNum = sprite.costumes.length + 1;

    if (!urls || urls.length === 0) {
      UI.openModal(title, `
        <p style="color:var(--text-dim);font-size:12px;line-height:1.6;">
          Library not loaded yet. Check your internet connection and try refreshing.
        </p>`);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'costume-library-grid';

    urls.forEach(item => {
      const cell = document.createElement('div');
      cell.className = 'costume-library-cell';

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = item.url;
      img.alt = item.name;
      img.loading = 'lazy';

      const label = document.createElement('div');
      label.className = 'costume-library-label';
      label.textContent = item.name;

      cell.appendChild(img);
      cell.appendChild(label);

      cell.addEventListener('click', async () => {
        const name = `${prefix} ${nextNum}`;
        sprite.costumes.push({ name, url: item.url });
        sprite.currentCostume = sprite.costumes.length - 1;
        UI.closeModal();
        await _afterCostumeChange(sprite);
      });

      grid.appendChild(cell);
    });

    UI.openModal(title, '');
    document.getElementById('modal-body').appendChild(grid);
  }

  function initControls() {
    // Wire the fixed header add button
    const headerBtn = document.getElementById('btn-add-costume-header');
    if (headerBtn) {
      headerBtn.addEventListener('click', () => {
        const sprite = Engine.getSelectedSprite();
        if (sprite) showAddOptions(sprite);
      });
    }
  }

  return { preload, load, initControls };
})();
