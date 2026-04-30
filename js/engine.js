// engine.js — core game state

const DEFAULT_SPRITE_URL = 'https://cdn.assets.scratch.mit.edu/internalapi/asset/bcf454acf82e4504149f7ffe07081dbc.svg/get/';
const DEFAULT_STAGE_URL  = 'https://cdn.assets.scratch.mit.edu/internalapi/asset/8eb8790be5507fdccf73e7c1570bbbab.svg/get/';

const Engine = (() => {
  const state = {
    sprites: [],
    stage: null,
    globals: {},
    lists: {},
    variableMonitors: {},
    running: false,
    selectedSpriteId: null,
  };

  function createSprite(opts = {}) {
    return {
      id: opts.id || Utils.uid(),
      name: opts.name || 'Sprite',
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      direction: opts.direction ?? 90,
      size: opts.size ?? 100,
      visible: opts.visible ?? true,
      rotationMode: opts.rotationMode || 'all',
      costumes: opts.costumes
        ? opts.costumes.map(c => ({ ...c }))
        : [{ name: 'Costume 1', url: DEFAULT_SPRITE_URL }],
      currentCostume: opts.currentCostume ?? 0,
      threads: opts.threads
        ? opts.threads.map(t => ({ ...t }))
        : [{ id: Utils.uid(), name: 'main', code: '' }],
      variables: opts.variables ? { ...opts.variables } : {},
      isClone: opts.isClone || false,
      cloneOf: opts.cloneOf || null,
      layer: opts.layer ?? 0,
      _img: null,
      _sayText: null,
      _sayTimer: null,
    };
  }

  function createStage(opts = {}) {
    return {
      id: 'stage',
      name: 'Stage',
      isStage: true,
      costumes: opts.costumes
        ? opts.costumes.map(c => ({ ...c }))
        : [{ name: 'Backdrop 1', url: DEFAULT_STAGE_URL }],
      currentCostume: opts.currentCostume ?? 0,
      threads: opts.threads
        ? opts.threads.map(t => ({ ...t }))
        : [{ id: Utils.uid(), name: 'main', code: '' }],
      variables: opts.variables ? { ...opts.variables } : {},
      _img: null,
    };
  }

  function getSprite(id) {
    if (id === 'stage') return state.stage;
    return state.sprites.find(s => s.id === id) || null;
  }

  function getAllSprites() { return [...state.sprites]; }
  function getSelectedSprite() { return getSprite(state.selectedSpriteId); }
  function selectSprite(id) { state.selectedSpriteId = id; }

  function addSprite(opts = {}) {
    const realCount = state.sprites.filter(s => !s.isClone).length + 1;
    const sprite = createSprite({
      name: `Sprite${realCount}`,
      layer: state.sprites.length,
      ...opts,
    });
    state.sprites.push(sprite);
    if (typeof Renderer !== 'undefined') Renderer.markSortDirty();
    return sprite;
  }

  function deleteSprite(id) {
    state.sprites = state.sprites.filter(s => s.id !== id);
    if (state.selectedSpriteId === id) {
      state.selectedSpriteId = state.sprites.length > 0 ? state.sprites[0].id : 'stage';
    }
    if (typeof Renderer !== 'undefined') Renderer.markSortDirty();
  }

  function moveToFront(id) {
    const maxL = state.sprites.reduce((m, s) => Math.max(m, s.layer), 0);
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

  function setGlobal(name, value) { state.globals[name] = value; _notifyMonitor(name); }
  function getGlobal(name) { return name in state.globals ? state.globals[name] : 0; }
  function setSpriteVar(spriteId, name, value) {
    const s = getSprite(spriteId); if (s) { s.variables[name] = value; _notifyMonitor(`${spriteId}:${name}`); }
  }
  function getSpriteVar(spriteId, name) {
    const s = getSprite(spriteId); return s && name in s.variables ? s.variables[name] : 0;
  }
  function displayVariable(name, visible, spriteId) {
    const key = spriteId ? `${spriteId}:${name}` : name;
    state.variableMonitors[key] = { visible: !!visible, name, spriteId: spriteId || null };
    _uiUpdateVars();
  }
  function _notifyMonitor(key) { if (state.variableMonitors[key]) _uiUpdateVars(); }

  function listCreate(name) { if (!state.lists[name]) state.lists[name] = []; }
  function listAdd(name, value) { (state.lists[name] = state.lists[name] || []).push(value); }
  function listRemove(name, index) { const l = state.lists[name]; if (l) l.splice(index - 1, 1); }
  function listGet(name, index) { const l = state.lists[name]; return l ? l[index - 1] : undefined; }

  function init() {
    state.stage = createStage();
    const sp = addSprite({ name: 'Sprite1' });
    state.selectedSpriteId = sp.id;
  }

  function reset() {
    state.sprites = []; state.stage = null;
    state.globals = {}; state.lists = {};
    state.variableMonitors = {};
    state.running = false; state.selectedSpriteId = null;
    init();
  }

  let _uiUpdateVars = () => {};
  function setVariableUpdateCallback(fn) { _uiUpdateVars = fn; }

  return {
    state, createSprite, createStage,
    getSprite, getAllSprites, getSelectedSprite, selectSprite,
    addSprite, deleteSprite, moveToFront, moveBackLayers, getSortedSprites,
    setGlobal, getGlobal, setSpriteVar, getSpriteVar, displayVariable,
    listCreate, listAdd, listRemove, listGet,
    init, reset, setVariableUpdateCallback,
  };
})();
