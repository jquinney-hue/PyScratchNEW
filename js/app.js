// app.js — bootstrap and top-level event wiring

window.addEventListener('DOMContentLoaded', async () => {
  // ── Init engine ────────────────────────────────────────────────
  Engine.init();

  // ── Init renderer ──────────────────────────────────────────────
  Renderer.init(document.getElementById('stage-canvas'));

  // ── Load default sprite images ────────────────────────────────
  await Renderer.loadSpriteImage(Engine.state.stage);
  for (const sp of Engine.getAllSprites()) {
    await Renderer.loadSpriteImage(sp);
  }

  // ── Init subsystems ───────────────────────────────────────────
  UI.init();
  Editor.init();
  CostumePanel.initControls();

  // ── Preload costume library (non-blocking) ─────────────────────
  CostumePanel.preload().catch(() => {});

  // ── Initial render ────────────────────────────────────────────
  UI.renderSpritePanel();
  Editor.loadSprite(Engine.getSelectedSprite());
  CostumePanel.load(Engine.getSelectedSprite());
  Renderer.render();

  // ── Top bar buttons ───────────────────────────────────────────
  document.getElementById('btn-start').addEventListener('click', () => {
    Editor.saveCurrentCode();
    Scheduler.startAll();
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    Scheduler.stopAll();
    Renderer.render();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    Project.save();
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('file-load-input').click();
  });

  document.getElementById('file-load-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      Project.load(e.target.files[0]);
      e.target.value = '';
    }
  });

  document.getElementById('btn-publish').addEventListener('click', () => {
    Publisher.publish();
  });

  document.getElementById('btn-help').addEventListener('click', showHelp);

  // ── Window resize ─────────────────────────────────────────────
  window.addEventListener('resize', () => {
    Renderer.resize();
    Renderer.render();
  });

  // ── Keyboard shortcuts ────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      Project.save();
    }
    if (e.key === 'Escape') {
      const area = document.getElementById('stage-area');
      if (area.classList.contains('fullscreen')) {
        area.classList.remove('fullscreen');
        Renderer.resize();
      }
    }
  });

  console.log('🐍 PyScratch ready!');
});

// ── Help modal ────────────────────────────────────────────────────
function showHelp() {
  const html = `
<div class="help-content">
  <p>Write Python code for each sprite. Functions named <b>game_start()</b>, <b>on_click()</b>, <b>on_keypress(key)</b> are called automatically.</p>

  <h3>Movement</h3>
  <code>move_steps(10)
turn(15)
go_to(0, 0)          # go to center
go_to("random")      # random position
glide_to(100, 50, 1) # glide in 1 second
change_x(5)
change_y(-3)
set_x(0) / set_y(0)
get_x() / get_y()
get_direction()</code>

  <h3>Looks</h3>
  <code>say("Hello!", 2)    # say for 2 seconds
say("Hi")           # say forever
set_costume("name")
next_costume()
set_size(150)
change_size(10)
show() / hide()</code>

  <h3>Control</h3>
  <code>wait(0.5)           # wait 0.5 seconds
stop()              # stop all threads
stop_this_thread()  # stop current thread</code>

  <h3>Sensing</h3>
  <code>touching("Sprite2")  # True/False
touching("edge")
distance_to("Sprite2")
key_pressed("space")
key_pressed("a")
mouse_x() / mouse_y()
mouse_down()</code>

  <h3>Events</h3>
  <code>def game_start():
    # runs when green flag clicked
    while True:
        move_steps(3)
        wait(0.016)

def on_click():
    # runs when sprite is clicked
    say("Ouch!")

def on_keypress(key):
    if key == "space":
        jump()

def on_broadcast(event):
    if event == "score":
        pass</code>

  <h3>Variables</h3>
  <code>set_var("score", 0)
get_var("score")
set_var("score", get_var("score") + 1)
display_variable("score", True)</code>

  <h3>Clones</h3>
  <code>create_clone()

def on_clone_start():
    # runs in each clone
    show()
    while True:
        move_steps(2)
        wait(0.016)

delete_clone()  # removes this clone</code>

  <h3>Broadcast</h3>
  <code>broadcast("game_over")
broadcast_and_wait("ready")</code>

  <h3>Edge & Bounce</h3>
  <code>if on_edge():
    bounce()

# Or combined:
def game_start():
    while True:
        move_steps(3)
        if on_edge():
            bounce()
        wait(0.016)</code>

  <h3>Layering</h3>
  <code>go_to_front()
go_back_layers(2)</code>

  <h3>Math</h3>
  <code>random(1, 10)      # random float
random_int(1, 6)   # random integer
timer()            # seconds since start
reset_timer()</code>
</div>`;

  UI.openModal('🐍 PyScratch Reference', html);
}
