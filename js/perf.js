// perf.js — live performance monitor panel

const PerfPanel = (() => {
  let _visible = false;
  let _el      = null;
  let _updateRaf = null;
  let _lastPerf  = null;

  // ── Build DOM ─────────────────────────────────────────────────
  function _build() {
    if (_el) return;

    _el = document.createElement('div');
    _el.id = 'perf-panel';
    _el.innerHTML = `
      <div id="perf-header">
        <span id="perf-title">⏱ Performance</span>
        <div id="perf-header-right">
          <button id="perf-clear" title="Clear thread log">Clear</button>
          <button id="perf-close" title="Close">×</button>
        </div>
      </div>
      <div id="perf-body">
        <div id="perf-gauges">
          <div class="perf-gauge">
            <div class="pg-label">FPS</div>
            <div class="pg-value" id="pg-fps">—</div>
          </div>
          <div class="perf-gauge">
            <div class="pg-label">Frame</div>
            <div class="pg-value" id="pg-frame">—</div>
          </div>
          <div class="perf-gauge">
            <div class="pg-label">Tick</div>
            <div class="pg-value" id="pg-tick">—</div>
          </div>
          <div class="perf-gauge">
            <div class="pg-label">Render</div>
            <div class="pg-value" id="pg-render">—</div>
          </div>
        </div>
        <canvas id="perf-graph" width="340" height="60"></canvas>
        <div id="perf-thread-log">
          <div class="ptl-header">
            <span class="ptl-col-name">Thread</span>
            <span class="ptl-col-ticks">Ticks</span>
            <span class="ptl-col-last">Last (ms)</span>
            <span class="ptl-col-avg">Avg (ms)</span>
            <span class="ptl-col-bar">Budget</span>
          </div>
          <div id="ptl-rows"></div>
        </div>
      </div>
    `;
    document.body.appendChild(_el);

    document.getElementById('perf-close').addEventListener('click', hide);
    document.getElementById('perf-clear').addEventListener('click', () => {
      if (Scheduler.perf) {
        Scheduler.perf.threadLog = {};
        Scheduler.perf.frameTimes  = [];
        Scheduler.perf.tickTimes   = [];
        Scheduler.perf.renderTimes = [];
        Scheduler.perf.frameCount  = 0;
      }
    });
  }

  // ── Show / Hide ───────────────────────────────────────────────
  function show() {
    _build();
    _visible = true;
    _el.style.display = 'flex';
  }

  function hide() {
    _visible = false;
    if (_el) _el.style.display = 'none';
  }

  function toggle() { _visible ? hide() : show(); }

  // ── Update (called every frame by Scheduler) ──────────────────
  function update(perf) {
    _lastPerf = perf;
    if (!_visible || !_el) return;
    _render(perf);
  }

  function _avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function _max(arr) { return arr.length ? Math.max(...arr) : 0; }
  function _fmt(ms)  { return ms < 0.1 ? '<0.1' : ms.toFixed(2); }

  function _render(perf) {
    const avgFrame  = _avg(perf.frameTimes);
    const avgTick   = _avg(perf.tickTimes);
    const avgRender = _avg(perf.renderTimes);
    const fps       = avgFrame > 0 ? (1000 / avgFrame).toFixed(1) : '—';

    // Colour FPS value
    const fpsEl = document.getElementById('pg-fps');
    if (fpsEl) {
      fpsEl.textContent = fps;
      fpsEl.className   = 'pg-value ' + (
        +fps >= 55 ? 'pg-good' : +fps >= 30 ? 'pg-warn' : 'pg-bad'
      );
    }

    _setText('pg-frame',  _fmt(avgFrame)  + 'ms');
    _setText('pg-tick',   _fmt(avgTick)   + 'ms');
    _setText('pg-render', _fmt(avgRender) + 'ms');

    _drawGraph(perf);
    _renderThreadLog(perf);
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── Sparkline graph ───────────────────────────────────────────
  function _drawGraph(perf) {
    const cv  = document.getElementById('perf-graph');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'hsla(225,15%,20%,0.9)';
    ctx.fillRect(0, 0, W, H);

    // 16.7ms target line
    const target = 16.7;
    const maxMs  = Math.max(50, _max(perf.frameTimes) * 1.2);

    const ty = H - (target / maxMs) * H;
    ctx.strokeStyle = 'hsla(133,55%,47%,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke();
    ctx.setLineDash([]);

    // Frame time line (white)
    _drawLine(ctx, perf.frameTimes, maxMs, W, H, 'hsla(0,0%,90%,0.9)', 1.5);
    // Tick time (purple)
    _drawLine(ctx, perf.tickTimes,  maxMs, W, H, 'hsla(260,60%,70%,0.8)', 1);
    // Render time (blue)
    _drawLine(ctx, perf.renderTimes,maxMs, W, H, 'hsla(215,80%,65%,0.8)', 1);

    // Legend
    ctx.font = '9px monospace';
    ctx.fillStyle = 'hsla(0,0%,90%,0.7)';  ctx.fillText('frame', 4, 10);
    ctx.fillStyle = 'hsla(260,60%,70%,0.8)'; ctx.fillText('tick',  4, 20);
    ctx.fillStyle = 'hsla(215,80%,65%,0.8)'; ctx.fillText('render',4, 30);
  }

  function _drawLine(ctx, data, maxMs, W, H, color, lw) {
    if (!data.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - (v / maxMs) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // ── Thread log table ──────────────────────────────────────────
  function _renderThreadLog(perf) {
    const container = document.getElementById('ptl-rows');
    if (!container) return;

    const entries = Object.entries(perf.threadLog);
    if (!entries.length) {
      container.innerHTML = '<div class="ptl-empty">No threads have run yet</div>';
      return;
    }

    // Sort by totalMs desc
    entries.sort((a, b) => b[1].totalMs - a[1].totalMs);

    const maxAvg = Math.max(...entries.map(([, e]) => e.ticks ? e.totalMs / e.ticks : 0));

    container.innerHTML = entries.map(([key, e]) => {
      const avg    = e.ticks ? e.totalMs / e.ticks : 0;
      const bar    = maxAvg > 0 ? (avg / maxAvg) * 100 : 0;
      const budget = avg / 16.7 * 100; // % of a 60fps frame budget
      const cls    = budget > 80 ? 'ptl-bad' : budget > 40 ? 'ptl-warn' : 'ptl-good';
      // Resolve sprite name
      const sprite = Engine.getSprite(e.spriteId);
      const sName  = sprite ? sprite.name : e.spriteId.substring(0, 6);
      return `<div class="ptl-row">
        <span class="ptl-col-name" title="${key}">${sName} / ${e.name}</span>
        <span class="ptl-col-ticks">${e.ticks}</span>
        <span class="ptl-col-last ${cls}">${_fmt(e.lastMs)}</span>
        <span class="ptl-col-avg  ${cls}">${_fmt(avg)}</span>
        <span class="ptl-col-bar">
          <span class="ptl-bar-fill ${cls}" style="width:${Math.min(100,bar).toFixed(1)}%"></span>
          <span class="ptl-bar-pct">${budget.toFixed(0)}%</span>
        </span>
      </div>`;
    }).join('');
  }

  return { show, hide, toggle, update };
})();
