// project.js — save / load / export

const Project = (() => {

  function serialize() {
    const state = Engine.state;

    // Serialize sprites
    const sprites = Engine.getAllSprites().map(sp => ({
      id: sp.id,
      name: sp.name,
      x: sp.x,
      y: sp.y,
      direction: sp.direction,
      size: sp.size,
      visible: sp.visible,
      rotationMode: sp.rotationMode,
      costumes: sp.costumes,
      currentCostume: sp.currentCostume,
      threads: sp.threads,
      variables: sp.variables,
      isClone: sp.isClone,
      cloneOf: sp.cloneOf,
      layer: sp.layer,
    }));

    return JSON.stringify({
      version: 2,
      stage: {
        costumes: state.stage.costumes,
        currentCostume: state.stage.currentCostume,
        threads: state.stage.threads,
        variables: state.stage.variables,
      },
      sprites,
      globals: state.globals,
      lists: state.lists,
    }, null, 2);
  }

  async function deserialize(json) {
    let data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      alert('Invalid project file.');
      return;
    }

    Engine.reset();

    // Restore stage
    if (data.stage) {
      Engine.state.stage.costumes = data.stage.costumes || [];
      Engine.state.stage.currentCostume = data.stage.currentCostume || 0;
      Engine.state.stage.threads = data.stage.threads || [{ id: Utils.uid(), name: 'main', code: '' }];
      Engine.state.stage.variables = data.stage.variables || {};
    }

    // Restore sprites
    Engine.state.sprites = [];
    for (const sd of (data.sprites || [])) {
      const sp = Engine.createSprite(sd);
      Engine.state.sprites.push(sp);
    }

    // Restore globals
    Engine.state.globals = data.globals || {};
    Engine.state.lists = data.lists || {};

    // Load images
    const all = [Engine.state.stage, ...Engine.getAllSprites()];
    await Promise.all(all.map(s => Renderer.loadSpriteImage(s)));

    // Select first sprite
    if (Engine.state.sprites.length > 0) {
      Engine.selectSprite(Engine.state.sprites[0].id);
    } else {
      Engine.selectSprite('stage');
    }
  }

  function save() {
    Editor.saveCurrentCode();
    const json = serialize();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project.ps2';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function load(file) {
    try {
      const text = await Utils.readFileAsText(file);
      await deserialize(text);
      UI.renderSpritePanel();
      Editor.loadSprite(Engine.getSelectedSprite());
      CostumePanel.load(Engine.getSelectedSprite());
      Renderer.render();
    } catch (e) {
      alert('Failed to load project: ' + e);
    }
  }

  return { serialize, deserialize, save, load };
})();
