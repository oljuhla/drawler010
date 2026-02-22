/**
 * canvas.js — Drawing engine
 *
 * Responsibilities:
 *  - Resize canvas to fit container, handling device pixel ratio (retina/iPad)
 *  - Capture Pointer Events (Apple Pencil pressure, tilt)
 *  - Smooth strokes with Perfect Freehand
 *  - Maintain stroke history (undo)
 *  - Export canvas as base64 PNG at a fixed resolution for SwarmUI
 *
 * Perfect Freehand is loaded from CDN as a UMD bundle.
 * The library exports getStroke under window.perfectFreehand or directly on window.
 */

; (function () {
  'use strict';

  // ── Perfect Freehand resolution ─────────────────────────────────────────
  // The UMD build can expose the function in two ways depending on bundler.
  const _pf = window.perfectFreehand;
  const getStroke = (_pf && _pf.getStroke) ? _pf.getStroke : window.getStroke;

  if (typeof getStroke !== 'function') {
    console.error('[canvas] Perfect Freehand not loaded — strokes will be plain dots.');
  }

  // ── State ────────────────────────────────────────────────────────────────

  const EXPORT_SIZE = 1024;  // pixels for AI generation

  let canvas, ctx;
  let strokes = [];          // completed: [{ points: [[x,y,p],...], size, color }]
  let currentPoints = [];    // in-progress: [[x,y,p],...]
  let isDrawing = false;
  let rafPending = false;

  // Defaults — overridden by ui.js via Canvas.setOptions()
  let brushSize = 10;
  let brushColor = '#1a1a1a';

  // Pressure debug callback
  let onPressureDebug = null;

  // ── Local Storage ────────────────────────────────────────────────────────

  function saveState() {
    try { localStorage.setItem('drawler_strokes', JSON.stringify(strokes)); } catch (e) { }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem('drawler_strokes');
      if (saved) strokes = JSON.parse(saved);
    } catch (e) { }
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    canvas = document.getElementById('drawing-canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: false });

    loadState();

    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerCancel, { passive: false });

    // Prevent context menu on long-press (iOS)
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    render();
  }

  // ── Canvas sizing ─────────────────────────────────────────────────────────

  function sizeCanvas() {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;

    // Determine the largest square that fits in the container
    const availW = wrap.clientWidth - 28;  // 14px padding each side
    const availH = wrap.clientHeight - 28;
    const side = Math.min(availW, availH);

    canvas.style.width = side + 'px';
    canvas.style.height = side + 'px';
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);

    const bg = document.getElementById('canvas-bg');
    if (bg) {
      bg.style.width = side + 'px';
      bg.style.height = side + 'px';
    }

    // Scale the context so we draw in logical pixels everywhere
    ctx.scale(dpr, dpr);

    render();
  }

  // Returns the logical (CSS) pixel size of the canvas
  function logicalSize() {
    return parseFloat(canvas.style.width) || canvas.width;
  }

  // ── Pointer event helpers ─────────────────────────────────────────────────

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return [
      e.clientX - rect.left,
      e.clientY - rect.top,
      e.pressure || 0.5,    // Apple Pencil sends real pressure; fallback for mouse
    ];
  }

  // ── Pointer event handlers ────────────────────────────────────────────────

  function onPointerDown(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    currentPoints = [canvasPoint(e)];
    debugPressure(e);
    requestRender();
  }

  function onPointerMove(e) {
    e.preventDefault();
    if (!isDrawing) return;
    currentPoints.push(canvasPoint(e));
    debugPressure(e);
    requestRender();
  }

  function onPointerUp(e) {
    e.preventDefault();
    if (!isDrawing) return;
    currentPoints.push(canvasPoint(e));
    commitStroke();
    requestRender();
  }

  function onPointerCancel(e) {
    if (!isDrawing) return;
    // Discard the partial stroke
    currentPoints = [];
    isDrawing = false;
    requestRender();
  }

  function commitStroke() {
    if (currentPoints.length > 1) {
      strokes.push({
        points: currentPoints.slice(),
        size: brushSize,
        color: brushColor,
      });
      saveState();
    }
    currentPoints = [];
    isDrawing = false;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function requestRender() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        render();
      });
    }
  }

  function render() {
    const side = logicalSize();
    ctx.clearRect(0, 0, side, side);

    for (const stroke of strokes) {
      drawStroke(ctx, stroke.points, stroke.size, stroke.color);
    }

    if (currentPoints.length > 0) {
      drawStroke(ctx, currentPoints, brushSize, brushColor, /* last */ false);
    }
  }

  /**
   * Convert a Perfect Freehand output polygon to a canvas Path2D.
   * Each point in `pts` is [x, y].
   */
  function strokeToPath2D(pts) {
    if (pts.length < 2) return null;
    const d = pts.reduce((acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    }, ['M', ...pts[0], 'Q']);
    d.push('Z');
    return new Path2D(d.join(' '));
  }

  function drawStroke(ctx, rawPoints, size, color, last = true) {
    if (!rawPoints.length) return;

    if (typeof getStroke === 'function') {
      const outline = getStroke(rawPoints, {
        size,
        thinning: 0.6,
        smoothing: 0.5,
        streamline: 0.5,
        easing: t => t,
        last,           // false while stroke is in progress — keeps tip clean
        simulatePressure: false,  // we provide real pressure as the 3rd value
      });

      const path = strokeToPath2D(outline);
      if (!path) return;
      ctx.fillStyle = color;
      ctx.fill(path);

    } else {
      // Fallback: plain round dots connected with quadratic curves
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(rawPoints[0][0], rawPoints[0][1]);
      for (let i = 1; i < rawPoints.length; i++) {
        ctx.lineTo(rawPoints[i][0], rawPoints[i][1]);
      }
      ctx.stroke();
    }
  }

  // ── Pressure debug ─────────────────────────────────────────────────────────

  function debugPressure(e) {
    if (onPressureDebug) {
      onPressureDebug({
        pressure: e.pressure,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        type: e.pointerType,
      });
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  /**
   * Export the current drawing as a base64-encoded PNG at EXPORT_SIZE × EXPORT_SIZE.
   * White background, dark strokes — suitable for ControlNet scribble input.
   *
   * @returns {string} base64 data URL (no "data:image/png;base64," prefix for API use)
   */
  function exportBase64() {
    const offscreen = document.createElement('canvas');
    offscreen.width = EXPORT_SIZE;
    offscreen.height = EXPORT_SIZE;
    const octx = offscreen.getContext('2d');

    // White background
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);

    const side = logicalSize();
    const scale = EXPORT_SIZE / side;

    // Redraw all strokes at EXPORT_SIZE resolution
    octx.save();
    octx.scale(scale, scale);
    for (const stroke of strokes) {
      drawStroke(octx, stroke.points, stroke.size, stroke.color);
    }
    octx.restore();

    // Return bare base64 (strip the data URL prefix)
    return offscreen.toDataURL('image/png').split(',')[1];
  }

  /**
   * Export as a full data URL — useful for "use as reference" (img element src).
   */
  function exportDataURL() {
    return 'data:image/png;base64,' + exportBase64();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function clear() {
    strokes = [];
    currentPoints = [];
    isDrawing = false;
    saveState();
    requestRender();
  }

  function undo() {
    if (strokes.length > 0) {
      strokes.pop();
      saveState();
      requestRender();
    }
  }

  function setOptions(opts = {}) {
    if (opts.size != null) brushSize = opts.size;
    if (opts.color != null) brushColor = opts.color;
  }

  function isEmpty() {
    return strokes.length === 0 && currentPoints.length === 0;
  }

  function setDebugCallback(fn) {
    onPressureDebug = fn;
  }

  // Expose
  window.DrawingCanvas = {
    init,
    clear,
    undo,
    setOptions,
    isEmpty,
    exportBase64,
    exportDataURL,
    setDebugCallback,
  };

}());
