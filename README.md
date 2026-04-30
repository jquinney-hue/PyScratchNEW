# 🐍 PyScratch

A browser-based, Scratch-like programming environment using real Python syntax, powered by [Skulpt](https://skulpt.org/).

## Features

- **Real Python execution** — write actual Python code for each sprite
- **Multiple threads per sprite** — parallel coroutine execution
- **60 FPS rendering** — canvas-based stage with full sprite engine
- **Event system** — `game_start()`, `on_click()`, `on_keypress()`, `broadcast()`
- **Clone system** — create and manage sprite clones
- **Variable monitors** — display variables on stage
- **Save/Load** — `.ps2` project format
- **Publish** — export standalone HTML

## Getting Started

Open `index.html` or visit the GitHub Pages URL.

### Quick Example

Select a sprite, click the **Code** tab, and write:

```python
def game_start():
    while True:
        move_steps(3)
        if on_edge():
            bounce()
        wait(0.016)
```

Press the green ▶ button to run!

## API Reference

Click the **Help** button in the editor for a full function reference.

## Project Structure

```
pyscratch/
├── index.html         # Main entry point
├── css/
│   ├── main.css       # Base styles
│   ├── editor.css     # Editor panel styles
│   └── panels.css     # Stage & sprite panel styles
└── js/
    ├── utils.js       # Shared utilities
    ├── engine.js      # Game state & sprite management
    ├── renderer.js    # Canvas rendering engine
    ├── python-api.js  # Skulpt Python bindings
    ├── scheduler.js   # Thread scheduler
    ├── editor.js      # Code editor
    ├── ui.js          # UI components
    ├── costumes.js    # Costume management
    ├── project.js     # Save/load
    ├── publish.js     # HTML export
    └── app.js         # Bootstrap
```

## GitHub Pages

This project is designed to be hosted on GitHub Pages. Simply push to a repository with Pages enabled — no build step required.
