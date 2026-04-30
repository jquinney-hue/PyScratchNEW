// editor.js — code editor management

const Editor = (() => {
  let currentSpriteId = null;
  let currentThreadId = null;

  const textarea = () => document.getElementById('code-editor');
  const lineNums = () => document.getElementById('line-numbers');
  const threadLabel = () => document.getElementById('current-thread-label');

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    const ta = textarea();

    ta.addEventListener('input', () => {
      saveCurrentCode();
      updateLineNumbers();
    });

    ta.addEventListener('scroll', () => {
      lineNums().scrollTop = ta.scrollTop;
    });

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 4;
        saveCurrentCode();
        updateLineNumbers();
      }
    });

    document.getElementById('btn-add-thread').addEventListener('click', addThread);
    document.getElementById('ctx-rename').addEventListener('click', renameThread);
    document.getElementById('ctx-delete').addEventListener('click', deleteThread);

    updateLineNumbers();
  }

  // ── Thread management ─────────────────────────────────────────
  function addThread() {
    const sprite = Engine.getSelectedSprite();
    if (!sprite) return;
    const thread = {
      id: Utils.uid(),
      name: `thread${sprite.threads.length + 1}`,
      code: '# New thread\ndef game_start():\n    pass\n'
    };
    sprite.threads.push(thread);
    renderThreadList(sprite);
    selectThread(sprite, thread.id);
  }

  let contextTarget = null;

  function renameThread() {
    if (!contextTarget) return;
    const sprite = Engine.getSelectedSprite();
    const thread = sprite.threads.find(t => t.id === contextTarget);
    if (!thread) return;

    const newName = prompt('Thread name:', thread.name);
    if (newName && newName.trim()) {
      thread.name = newName.trim();
      renderThreadList(sprite);
    }
    hideContextMenu();
  }

  function deleteThread() {
    if (!contextTarget) return;
    const sprite = Engine.getSelectedSprite();
    if (sprite.threads.length <= 1) {
      alert('Cannot delete the last thread.');
      hideContextMenu();
      return;
    }
    sprite.threads = sprite.threads.filter(t => t.id !== contextTarget);
    if (currentThreadId === contextTarget) {
      selectThread(sprite, sprite.threads[0].id);
    }
    renderThreadList(sprite);
    hideContextMenu();
  }

  function hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
    contextTarget = null;
  }

  // ── Render thread list ────────────────────────────────────────
  function renderThreadList(sprite) {
    const list = document.getElementById('thread-list');
    if (!sprite) { list.innerHTML = ''; return; }

    list.innerHTML = sprite.threads.map(t => `
      <div class="thread-item ${t.id === currentThreadId ? 'active' : ''}" 
           data-thread-id="${t.id}">
        <div class="thread-dot"></div>
        <div class="thread-name">${escapeHtml(t.name)}</div>
      </div>
    `).join('');

    list.querySelectorAll('.thread-item').forEach(el => {
      el.addEventListener('click', () => {
        selectThread(sprite, el.dataset.threadId);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextTarget = el.dataset.threadId;
        showContextMenu(e.clientX, e.clientY);
      });
    });

    // Update running state
    Scheduler.updateThreadUI();
  }

  function showContextMenu(x, y) {
    const menu = document.getElementById('context-menu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
  }

  document.addEventListener('click', () => hideContextMenu());

  // ── Select thread ─────────────────────────────────────────────
  function selectThread(sprite, threadId) {
    saveCurrentCode();
    currentSpriteId = sprite.id;
    currentThreadId = threadId;

    const thread = sprite.threads.find(t => t.id === threadId);
    if (!thread) return;

    textarea().value = thread.code || '';
    threadLabel().textContent = `${sprite.name} → ${thread.name}`;
    updateLineNumbers();
    renderThreadList(sprite);

    // Clear error
    document.getElementById('error-overlay').classList.add('hidden');
  }

  function saveCurrentCode() {
    if (!currentSpriteId || !currentThreadId) return;
    const sprite = Engine.getSprite(currentSpriteId);
    if (!sprite) return;
    const thread = sprite.threads.find(t => t.id === currentThreadId);
    if (thread) thread.code = textarea().value;
  }

  function updateLineNumbers() {
    const ta = textarea();
    const lines = ta.value.split('\n').length;
    lineNums().innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>');
  }

  // ── Load sprite into editor ───────────────────────────────────
  function loadSprite(sprite) {
    if (!sprite) {
      textarea().value = '';
      document.getElementById('thread-list').innerHTML = '';
      threadLabel().textContent = '';
      return;
    }

    if (!sprite.threads || sprite.threads.length === 0) {
      sprite.threads = [{ id: Utils.uid(), name: 'main', code: '' }];
    }

    renderThreadList(sprite);
    selectThread(sprite, sprite.threads[0].id);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { init, loadSprite, renderThreadList, selectThread, saveCurrentCode };
})();
