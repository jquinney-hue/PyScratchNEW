// project.js — save / load

const Project = (() => {

  function serialize() {
    const s = Engine.state;
    return JSON.stringify({
      version: 2,
      stage: {
        costumes:       s.stage.costumes,
        currentCostume: s.stage.currentCostume,
        threads:        s.stage.threads,
        variables:      s.stage.variables,
      },
      sprites: Engine.getAllSprites().filter(sp => !sp.isClone).map(sp => ({
        id:             sp.id,
        name:           sp.name,
        x: sp.x, y: sp.y,
        direction:      sp.direction,
        size:           sp.size,
        visible:        sp.visible,
        rotationMode:   sp.rotationMode,
        costumes:       sp.costumes,
        currentCostume: sp.currentCostume,
        threads:        sp.threads,
        variables:      sp.variables,
        layer:          sp.layer,
      })),
      globals: s.globals,
      lists:   s.lists,
    }, null, 2);
  }

  async function deserialize(json) {
    let data;
    try { data = JSON.parse(json); }
    catch(e) { alert('Invalid .ps2 file.'); return false; }

    Engine.reset(); // resets state and calls init() (creates fresh stage+sprite)

    // Overwrite stage with saved data
    const st = data.stage || {};
    if (st.costumes)       Engine.state.stage.costumes       = st.costumes.map(c => ({...c}));
    if (st.currentCostume !== undefined) Engine.state.stage.currentCostume = st.currentCostume;
    if (st.threads)        Engine.state.stage.threads        = st.threads.map(t => ({...t}));
    if (st.variables)      Engine.state.stage.variables      = { ...st.variables };

    // Replace sprites
    Engine.state.sprites = [];
    for (const sd of (data.sprites || [])) {
      const sp = Engine.createSprite(sd);
      Engine.state.sprites.push(sp);
    }

    Engine.state.globals = data.globals || {};
    Engine.state.lists   = data.lists   || {};

    // Load all images
    const all = [Engine.state.stage, ...Engine.getAllSprites()];
    await Promise.all(all.map(s => Renderer.loadSpriteImage(s)));

    // Select first sprite
    Engine.selectSprite(
      Engine.state.sprites.length > 0 ? Engine.state.sprites[0].id : 'stage'
    );
    return true;
  }

  function save() {
    Editor.saveCurrentCode();
    const json = serialize();
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'project.ps2'; a.click();
    URL.revokeObjectURL(url);
  }

  async function load(file) {
    try {
      const text = await Utils.readFileAsText(file);
      const ok   = await deserialize(text);
      if (!ok) return;
      UI.renderSpritePanel();
      Editor.loadSprite(Engine.getSelectedSprite());
      CostumePanel.load(Engine.getSelectedSprite());
      Renderer.render();
    } catch(e) {
      alert('Failed to load project: ' + e);
    }
  }

  return { serialize, deserialize, save, load };
})();
