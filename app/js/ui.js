/**
 * ui.js — UI glue layer
 *
 * Wires together:
 *  - DrawingCanvas (canvas.js)
 *  - SwarmAPI (api.js)
 *  - DOM elements (prompt, sliders, buttons, overlays)
 *
 * Also handles:
 *  - Pressure debug display
 *  - Result overlay (show, save, use-as-reference)
 *  - Status / progress reporting
 */

;(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  const promptInput    = $('prompt-input');
  const negPromptInput = $('neg-prompt-input');
  const generateBtn    = $('generate-btn');
  const clearBtn       = $('clear-btn');
  const undoBtn        = $('undo-btn');

  const brushSizeInput = $('brush-size');
  const brushSizeVal   = $('brush-size-val');
  const stepsInput     = $('steps-input');
  const stepsVal       = $('steps-val');
  const strengthInput  = $('strength-input');
  const strengthVal    = $('strength-val');
  const cfgInput       = $('cfg-input');
  const cfgVal         = $('cfg-val');

  const statusSection  = $('status-section');
  const progressFill   = $('progress-fill');
  const statusText     = $('status-text');

  const resultOverlay  = $('result-overlay');
  const resultImg      = $('result-img');
  const closeResultBtn = $('close-result-btn');
  const saveBtn        = $('save-btn');
  const useAsRefBtn    = $('use-as-ref-btn');

  const pressureDebug  = $('pressure-debug');
  const pressureDebugBtn = $('pressure-debug-btn');
  const dbgPressure    = $('dbg-pressure');
  const dbgTiltX       = $('dbg-tiltx');
  const dbgTiltY       = $('dbg-tilty');
  const dbgType        = $('dbg-type');

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    DrawingCanvas.init();

    bindSliders();
    bindToolbar();
    bindGenerate();
    bindResultOverlay();
    bindPressureDebug();

    // Set initial brush options
    DrawingCanvas.setOptions({ size: parseInt(brushSizeInput.value, 10) });

    // Check SwarmUI connectivity (non-blocking)
    checkSwarm();
  }

  // ── Sliders ───────────────────────────────────────────────────────────────

  function bindSliders() {
    brushSizeInput.addEventListener('input', () => {
      const v = parseInt(brushSizeInput.value, 10);
      brushSizeVal.textContent = v;
      DrawingCanvas.setOptions({ size: v });
    });

    stepsInput.addEventListener('input', () => {
      stepsVal.textContent = stepsInput.value;
    });

    strengthInput.addEventListener('input', () => {
      strengthVal.textContent = (parseInt(strengthInput.value, 10) / 100).toFixed(2);
    });

    cfgInput.addEventListener('input', () => {
      cfgVal.textContent = (parseInt(cfgInput.value, 10) / 10).toFixed(1);
    });
  }

  // ── Toolbar buttons ───────────────────────────────────────────────────────

  function bindToolbar() {
    clearBtn.addEventListener('click', () => {
      if (DrawingCanvas.isEmpty()) return;
      if (confirm('Clear the canvas?')) DrawingCanvas.clear();
    });

    undoBtn.addEventListener('click', () => {
      DrawingCanvas.undo();
    });
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  function bindGenerate() {
    generateBtn.addEventListener('click', onGenerate);
  }

  async function onGenerate() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      promptInput.focus();
      promptInput.style.borderColor = '#e05050';
      setTimeout(() => { promptInput.style.borderColor = ''; }, 1200);
      return;
    }

    if (DrawingCanvas.isEmpty()) {
      setStatus('Draw something first, then generate.');
      return;
    }

    generateBtn.disabled = true;
    showStatus('Preparing…', 0);

    try {
      const imageBase64 = DrawingCanvas.exportBase64();
      const negPrompt   = negPromptInput.value.trim() || 'blurry, bad quality, artifacts, jpeg noise';
      const steps       = parseInt(stepsInput.value, 10);
      const strength    = parseInt(strengthInput.value, 10) / 100;
      const cfg         = parseInt(cfgInput.value, 10) / 10;

      setStatus('Connecting to SwarmUI…', 0);

      const dataURL = await SwarmAPI.generate(
        imageBase64,
        prompt,
        negPrompt,
        { steps, strength, cfg },
        (fraction, text) => {
          setStatus(text, fraction);
        }
      );

      hideStatus();
      showResult(dataURL, prompt);

    } catch (err) {
      console.error('[generate]', err);
      setStatus('Error: ' + err.message, 0);
      setTimeout(hideStatus, 5000);
    } finally {
      generateBtn.disabled = false;
    }
  }

  // ── Status display ─────────────────────────────────────────────────────────

  function showStatus(text, fraction) {
    statusSection.classList.remove('hidden');
    statusText.textContent = text;
    progressFill.style.width = Math.round((fraction || 0) * 100) + '%';
  }

  function setStatus(text, fraction) {
    showStatus(text, fraction);
  }

  function hideStatus() {
    statusSection.classList.add('hidden');
    progressFill.style.width = '0%';
  }

  // ── Result overlay ─────────────────────────────────────────────────────────

  function showResult(dataURL, prompt) {
    resultImg.src = dataURL;
    resultImg.alt = prompt;
    resultOverlay.classList.remove('hidden');
  }

  function hideResult() {
    resultOverlay.classList.add('hidden');
    resultImg.src = '';
  }

  function bindResultOverlay() {
    closeResultBtn.addEventListener('click', hideResult);

    // Close on backdrop click
    resultOverlay.addEventListener('click', e => {
      if (e.target === resultOverlay) hideResult();
    });

    saveBtn.addEventListener('click', () => {
      if (!resultImg.src) return;
      const a = document.createElement('a');
      a.href = resultImg.src;
      a.download = 'drawler-' + Date.now() + '.png';
      a.click();
    });

    useAsRefBtn.addEventListener('click', () => {
      // Display the generated image as a semi-transparent reference layer over the canvas
      const canvasEl = document.getElementById('drawing-canvas');
      const canvasWrap = canvasEl.parentElement;

      // Remove any existing reference layer
      const existing = document.getElementById('ref-layer');
      if (existing) existing.remove();

      const ref = document.createElement('img');
      ref.id = 'ref-layer';
      ref.src = resultImg.src;
      Object.assign(ref.style, {
        position: 'absolute',
        inset: 0,
        width: canvasEl.style.width,
        height: canvasEl.style.height,
        objectFit: 'contain',
        opacity: '0.35',
        pointerEvents: 'none',
        borderRadius: '4px',
        // Centre it the same way the canvas is centred
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      });

      canvasWrap.appendChild(ref);
      hideResult();
      setStatus('Reference overlay active — draw on top of it.', 1);
      setTimeout(hideStatus, 3000);
    });
  }

  // ── Pressure debug ─────────────────────────────────────────────────────────

  function bindPressureDebug() {
    let debugVisible = false;

    pressureDebugBtn.addEventListener('click', () => {
      debugVisible = !debugVisible;
      pressureDebug.classList.toggle('hidden', !debugVisible);
      pressureDebugBtn.style.color = debugVisible ? '#6c63ff' : '';
    });

    DrawingCanvas.setDebugCallback(({ pressure, tiltX, tiltY, type }) => {
      if (!debugVisible) return;
      dbgPressure.textContent = pressure.toFixed(3);
      dbgTiltX.textContent    = tiltX ?? '—';
      dbgTiltY.textContent    = tiltY ?? '—';
      dbgType.textContent     = type  ?? '—';
    });
  }

  // ── SwarmUI connectivity check ─────────────────────────────────────────────

  async function checkSwarm() {
    const hint = document.getElementById('config-hint');
    try {
      const ok = await SwarmAPI.checkConnectivity();
      if (ok) {
        hint.innerHTML = 'SwarmUI <span style="color:#50e0a0">connected</span>';
      } else {
        hint.innerHTML = 'SwarmUI <span style="color:#e09050">not reachable</span> — check <code>js/api.js</code>';
      }
    } catch {
      hint.innerHTML = 'SwarmUI <span style="color:#e05050">offline</span> — check <code>js/api.js</code>';
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
