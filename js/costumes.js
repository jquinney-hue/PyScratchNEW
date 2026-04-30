// costumes.js — costume panel and library browser

const CostumePanel = (() => {
  const SPRITE_URL = 'https://raw.githubusercontent.com/jquinney-hue/pyscratchurls.github.io/refs/heads/main/costumeurls.txt';
  const BACKDROP_URL = 'https://raw.githubusercontent.com/jquinney-hue/pyscratchurls.github.io/refs/heads/main/backdropurls.txt';

  let cachedSpriteUrls = null;
  let cachedBackdropUrls = null;

  // ── Cache on startup ──────────────────────────────────────────
  async function preload() {
    try {
      const [s, b] = await Promise.all([
        Utils.fetchText(SPRITE_URL),
        Utils.fetchText(BACKDROP_URL),
      ]);
      if (s) cachedSpriteUrls = parseUrlList(s);
      if (b) cachedBackdropUrls = parseUrlList(b);
    } catch (e) {
      console.warn('Could not preload costume URLs', e);
    }
  }

  function parseUrlList(text) {
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(url => {
        const parts = url.split('/');
        const name = parts[parts.length - 1].replace(/\.\w+$/, '') || url;
        return { url: Utils.resolveUrl(url), name };
      });
  }

  // ── Load a sprite into the costume panel ──────────────────────
  function load(sprite) {
    if (!sprite) { renderEmpty(); return; }

    const title = document.getElementById('costume-panel-title');
    title.textContent = sprite.isStage ? 'Backdrops' : 'Costumes';

    renderList(sprite);
  }

  function renderEmpty() {
    document.getElementById('costume-list').innerHTML = '<div style="color:var(--text-muted);padding:12px;font-size:12px;">Select a sprite</div>';
  }

  function renderList(sprite) {
    const list = document.getElementById('costume-list');
    list.innerHTML = '';

    sprite.costumes.forEach((costume, i) => {
      const item = document.createElement('div');
      item.className = 'costume-item' + (i === sprite.currentCostume ? ' active' : '');

      const img = document.createElement('img');
      if (costume.url) {
        img.src = costume.url;
        img.onerror = () => { img.src = ''; img.style.display = 'none'; item.querySelector('.costume-emoji').style.display = 'block'; };
      } else {
        img.style.display = 'none';
      }

      const emoji = document.createElement('span');
      emoji.className = 'costume-emoji';
      emoji.textContent = costume.emoji || '🐱';
      emoji.style.display = costume.url ? 'none' : 'flex';
      emoji.style.alignItems = 'center';
      emoji.style.justifyContent = 'center';
      emoji.style.fontSize = '24px';
      emoji.style.width = '36px';
      emoji.style.height = '36px';

      const nameEl = document.createElement('span');
      nameEl.className = 'costume-name';
      nameEl.textContent = costume.name;

      const del = document.createElement('button');
      del.className = 'btn-icon';
      del.title = 'Remove';
      del.innerHTML = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sprite.costumes.length <= 1) { alert('Need at least one costume.'); return; }
        sprite.costumes.splice(i, 1);
        if (sprite.currentCostume >= sprite.costumes.length) sprite.currentCostume--;
        Renderer.loadSpriteImage(sprite).then(() => { renderList(sprite); Renderer.render(); });
      });

      item.appendChild(emoji);
      item.appendChild(img);
      item.appendChild(nameEl);
      item.appendChild(del);

      item.addEventListener('click', () => {
        sprite.currentCostume = i;
        Renderer.loadSpriteImage(sprite).then(() => { renderList(sprite); Renderer.render(); });
      });

      list.appendChild(item);
    });
  }

  // ── Add from URL ──────────────────────────────────────────────
  function initControls() {
    document.getElementById('btn-add-costume-url').addEventListener('click', addFromUrl);
    document.getElementById('costume-url-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addFromUrl();
    });
    document.getElementById('btn-browse-costumes').addEventListener('click', openBrowser);
  }

  async function addFromUrl() {
    const input = document.getElementById('costume-url-input');
    const url = input.value.trim();
    if (!url) return;

    const sprite = Engine.getSelectedSprite();
    if (!sprite) return;

    const parts = url.split('/');
    const name = parts[parts.length - 1].replace(/\.\w+$/, '') || 'costume';
    const costume = { name, url: Utils.resolveUrl(url) };
    sprite.costumes.push(costume);
    sprite.currentCostume = sprite.costumes.length - 1;
    input.value = '';

    await Renderer.loadSpriteImage(sprite);
    renderList(sprite);
    Renderer.render();
  }

  // ── Library browser ───────────────────────────────────────────
  function openBrowser() {
    const sprite = Engine.getSelectedSprite();
    if (!sprite) return;

    const isStage = sprite.isStage;
    const urls = isStage ? cachedBackdropUrls : cachedSpriteUrls;
    const title = isStage ? 'Backdrop Library' : 'Costume Library';

    if (!urls || urls.length === 0) {
      UI.openModal(title, '<p style="color:var(--text-dim);font-size:12px;">No library items available. Check your internet connection.</p>');
      return;
    }

    let html = `<div class="costume-grid">`;
    for (const item of urls) {
      html += `
        <div class="costume-thumb" data-url="${item.url}" data-name="${item.name}" title="${item.name}">
          <img src="${item.url}" alt="${item.name}" loading="lazy" />
          <div class="name">${item.name}</div>
        </div>
      `;
    }
    html += '</div>';

    UI.openModal(title, html);

    // Bind clicks
    document.querySelectorAll('.costume-thumb').forEach(el => {
      el.addEventListener('click', async () => {
        const costume = { name: el.dataset.name, url: el.dataset.url };
        sprite.costumes.push(costume);
        sprite.currentCostume = sprite.costumes.length - 1;
        await Renderer.loadSpriteImage(sprite);
        renderList(sprite);
        Renderer.render();
        UI.closeModal();
      });
    });
  }

  return { preload, load, initControls };
})();
