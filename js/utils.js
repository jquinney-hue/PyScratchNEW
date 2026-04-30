// utils.js — shared helpers

const Utils = {
  uid: () => Math.random().toString(36).slice(2, 10),

  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),

  degToRad: (d) => (d * Math.PI) / 180,
  radToDeg: (r) => (r * 180) / Math.PI,

  // Scratch direction (90=right) to canvas rotation radians
  scratchDirToRad: (dir) => Utils.degToRad(dir - 90),

  lerp: (a, b, t) => a + (b - a) * t,

  deepClone: (obj) => JSON.parse(JSON.stringify(obj)),

  // Wrap angle to -180..180
  wrapAngle: (a) => {
    while (a > 180) a -= 360;
    while (a <= -180) a += 360;
    return a;
  },

  // distance between two points
  dist: (x1, y1, x2, y2) =>
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),

  // Convert hex color to rgb array
  hexToRgb: (hex) => {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r
      ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)]
      : [0, 0, 0];
  },

  // Read a file as text
  readFileAsText: (file) =>
    new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = (e) => res(e.target.result);
      fr.onerror = rej;
      fr.readAsText(file);
    }),

  // Resolve a URL with /get/ suffix if needed
  resolveUrl: (url) => {
    if (!url) return url;
    if (!url.endsWith('/get/') && !url.match(/\.\w{2,5}$/)) {
      return url.endsWith('/') ? url + 'get/' : url + '/get/';
    }
    return url;
  },

  // Fetch text with timeout
  fetchText: async (url, timeout = 5000) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      return await r.text();
    } catch { return null; }
    finally { clearTimeout(tid); }
  },

  // Debounce
  debounce: (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
};
