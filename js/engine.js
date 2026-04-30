// engine.js — core game state

const Engine = (() => {
  // ── State ──────────────────────────────────────────────────────
  let state = {
    sprites: [],       // Sprite[]
    stage: null,       // Stage object (special sprite)
    globals: {},       // name -> value
    lists: {},         // name -> value[]
    variableMonitors: {}, // name -> { visible, sprite }
    running: false,
    selectedSpriteId: null,
  };

  // ── Sprite factory ─────────────────────────────────────────────
  function createSprite(opts = {}) {
    return {
      id: opts.id || Utils.uid(),
      name: opts.name || 'Sprite',
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      direction: opts.direction ?? 90,
      size: opts.size ?? 100,
      visible: opts.visible ?? true,
      rotationMode: opts.rotationMode || 'all', // all | leftright | none
      costumes: opts.costumes || [],
      currentCostume: opts.currentCostume || 0,
      threads: opts.threads || [{ id: Utils.uid(), name: 'main', code: '' }],
      variables: opts.variables || {},
      isClone: opts.isClone || false,
      cloneOf: opts.cloneOf || null,
      layer: opts.layer ?? 0,
      // Runtime state (not saved)
      _img: null,
      _sayText: null,
      _sayTimer: null,
      _hidden: false,
    };
  }

  function createStage(opts = {}) {
    return {
      id: 'stage',
      name: 'Stage',
      costumes: opts.costumes || [],
      currentCostume: opts.currentCostume || 0,
      threads: opts.threads || [{ id: Utils.uid(), name: 'main', code: '' }],
      variables: opts.variables || {},
      isStage: true,
      _img: null,
    };
  }

  // ── Accessors ──────────────────────────────────────────────────
  function getSprite(id) {
    if (id === 'stage') return state.stage;
    return state.sprites.find(s => s.id === id) || null;
  }

  function getAllSprites() {
    return [...state.sprites];
  }

  function getSelectedSprite() {
    return getSprite(state.selectedSpriteId);
  }

  function selectSprite(id) {
    state.selectedSpriteId = id;
  }

  function addSprite(opts = {}) {
    const sprite = createSprite({
      name: `Sprite${state.sprites.length + 1}`,
      layer: state.sprites.length,
      ...opts,
    });
    state.sprites.push(sprite);
    return sprite;
  }

  function deleteSprite(id) {
    state.sprites = state.sprites.filter(s => s.id !== id);
    if (state.selectedSpriteId === id) {
      state.selectedSpriteId = state.stage.id;
    }
  }

  function moveToFront(id) {
    const maxL = Math.max(0, ...state.sprites.map(s => s.layer));
    const s = getSprite(id);
    if (s) s.layer = maxL + 1;
  }

  function moveBackLayers(id, n) {
    const s = getSprite(id);
    if (s) s.layer = Math.max(0, s.layer - n);
  }

  function getSortedSprites() {
    return [...state.sprites].sort((a, b) => a.layer - b.layer);
  }

  // ── Variables ──────────────────────────────────────────────────
  function setGlobal(name, value) {
    state.globals[name] = value;
    _updateMonitor(name);
  }

  function getGlobal(name) {
    return state.globals[name] ?? 0;
  }

  function setSpriteVar(spriteId, name, value) {
    const s = getSprite(spriteId);
    if (s) {
      s.variables[name] = value;
      _updateMonitor(`${spriteId}:${name}`);
    }
  }

  function getSpriteVar(spriteId, name) {
    const s = getSprite(spriteId);
    return s ? (s.variables[name] ?? 0) : 0;
  }

  function displayVariable(name, visible, spriteId) {
    const key = spriteId ? `${spriteId}:${name}` : name;
    state.variableMonitors[key] = { visible, name, spriteId };
    UI_updateVariableDisplay();
  }

  function _updateMonitor(key) {
    if (state.variableMonitors[key]) {
      UI_updateVariableDisplay();
    }
  }

  // ── Lists ──────────────────────────────────────────────────────
  function listCreate(name) { state.lists[name] = []; }
  function listAdd(name, value) { (state.lists[name] = state.lists[name] || []).push(value); }
  function listRemove(name, index) {
    const l = state.lists[name];
    if (l) l.splice(index - 1, 1); // 1-indexed
  }
  function listGet(name, index) {
    const l = state.lists[name];
    return l ? l[index - 1] : undefined;
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    state.stage = createStage({
      costumes: [],
      threads: [{ id: Utils.uid(), name: 'main', code: '' }]
    });
    state.selectedSpriteId = 'stage';

    // Add a default sprite
    const sp = addSprite({ name: 'Sprite1' });
    // Default cat costume (emoji fallback)
    sp.costumes = [{ name: 'default', url: '', emoji: '🐱' }];
    state.selectedSpriteId = sp.id;
  }

  function reset() {
    state.sprites = [];
    state.stage = null;
    state.globals = {};
    state.lists = {};
    state.variableMonitors = {};
    state.running = false;
    state.selectedSpriteId = null;
    init();
  }

  // Expose for variable monitor update (set by UI)
  let UI_updateVariableDisplay = () => {};
  function setVariableUpdateCallback(fn) { UI_updateVariableDisplay = fn; }

  return {
    state,
    createSprite,
    createStage,
    getSprite,
    getAllSprites,
    getSelectedSprite,
    selectSprite,
    addSprite,
    deleteSprite,
    moveToFront,
    moveBackLayers,
    getSortedSprites,
    setGlobal,
    getGlobal,
    setSpriteVar,
    getSpriteVar,
    displayVariable,
    listCreate,
    listAdd,
    listRemove,
    listGet,
    init,
    reset,
    setVariableUpdateCallback,
  };
})();
