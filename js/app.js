// app.js — bootstrap

window.addEventListener('DOMContentLoaded', async () => {
  // ── Init engine & renderer ────────────────────────────────────
  Engine.init();
  Renderer.init(document.getElementById('stage-canvas'));

  // ── Load initial images ───────────────────────────────────────
  const loadAll = async () => {
    const targets = [Engine.state.stage, ...Engine.getAllSprites()];
    await Promise.all(targets.map(s => Renderer.loadSpriteImage(s)));
  };
  await loadAll();

  // ── Init subsystems ───────────────────────────────────────────
  UI.init();
  Editor.init();
  // CostumePanel controls are built dynamically per sprite — no global wiring needed

  // ── Preload costume library (background) ─────────────────────
  CostumePanel.preload().catch(() => {});

  // ── Initial UI render ─────────────────────────────────────────
  UI.renderSpritePanel();
  Editor.loadSprite(Engine.getSelectedSprite());
  CostumePanel.load(Engine.getSelectedSprite());
  Renderer.render();

  // ── Top bar ───────────────────────────────────────────────────
  document.getElementById('btn-start').addEventListener('click', () => {
    Editor.saveCurrentCode();
    Scheduler.startAll();
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    Scheduler.stopAll();
    Renderer.render();
  });

  document.getElementById('btn-save').addEventListener('click', () => Project.save());

  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('file-load-input').click();
  });

  document.getElementById('file-load-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) { await Project.load(file); e.target.value = ''; }
  });

  document.getElementById('btn-publish').addEventListener('click', () => Publisher.publish());
  document.getElementById('btn-help').addEventListener('click', showHelp);

  // ── Shortcuts ─────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      Project.save();
    }
    if (e.key === 'Escape') {
      const area = document.getElementById('stage-area');
      if (area.classList.contains('fullscreen')) {
        area.classList.remove('fullscreen');
        Renderer.resize();
        Renderer.render();
      }
    }
  });

  console.log('🐍 PyScratch ready!');
});

// ── Help reference ────────────────────────────────────────────────
function showHelp() {
  UI.openModal('🐍 PyScratch — Function Reference', `
<div class="help-content">
<p>Write Python in each thread. Functions below are available globally.</p>

<h3>Movement</h3>
<code>move_steps(steps)             # move forward in facing direction
turn(degrees)                 # rotate clockwise
go_to(x, y)                  # teleport to position
go_to("random")              # teleport to random position
glide_to(x, y, seconds)      # smooth glide
point_towards("mouse_pointer") # or sprite name
change_x(amount) / change_y(amount)
set_x(x) / set_y(y)
get_x() / get_y() / get_direction()</code>

<h3>Edge &amp; Bounce</h3>
<code>if on_edge():
    bounce()
# direction: 0=up, 90=right, 180=down, -90=left</code>

<h3>Looks</h3>
<code>say("Hello!", 2)   # speech bubble for 2 seconds
say("Hi")          # permanent bubble
set_costume("name")
next_costume()
set_stage("name") / next_stage()
set_size(100) / change_size(10)
show() / hide()</code>

<h3>Events</h3>
<code>def game_start():    # green flag
def on_click():      # sprite clicked
def on_keypress(key):  # "space","up","a", etc
def on_stage_loaded(stage):
def on_broadcast(event_name):
broadcast("name")
broadcast_and_wait("name")</code>

<h3>Control</h3>
<code>wait(seconds)
stop()             # stop all threads
stop_this_thread()</code>

<h3>Sensing</h3>
<code>touching("Sprite2")
touching("edge") / touching("mouse_pointer")
touching_color("#ff0000")
distance_to("Sprite2") / distance_to("mouse_pointer")
ask("What is your name?")  # returns answer
key_pressed("space")
mouse_x() / mouse_y() / mouse_down()</code>

<h3>Variables</h3>
<code>set_var("score", 0)
get_var("score")
display_variable("score", True)   # show on stage</code>

<h3>Clones</h3>
<code>create_clone()
def on_clone_start():
    show()
    while True:
        move_steps(2)
        wait(0.016)
delete_clone()</code>

<h3>Layering</h3>
<code>go_to_front()
go_back_layers(2)</code>

<h3>Math</h3>
<code>random(1.0, 10.0)    # random float
random_int(1, 6)     # random integer
timer()              # seconds since start
reset_timer()</code>
</div>`);
}
