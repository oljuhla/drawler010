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

; (function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  const promptInput = $('prompt-input');
  const negPromptInput = $('neg-prompt-input');
  const generateBtn = $('generate-btn');
  const clearBtn = $('clear-btn');
  const undoBtn = $('undo-btn');

  const brushSizeInput = $('brush-size');
  const brushSizeVal = $('brush-size-val');
  const stepsInput = $('steps-input');
  const stepsVal = $('steps-val');
  const strengthInput = $('strength-input');
  const strengthVal = $('strength-val');
  const cfgInput = $('cfg-input');
  const cfgVal = $('cfg-val');

  const statusSection = $('status-section');
  const progressFill = $('progress-fill');
  const statusText = $('status-text');

  const resultOverlay = $('result-overlay');
  const resultImg = $('result-img');
  const closeResultBtn = $('close-result-btn');
  const saveBtn = $('save-btn');
  const useAsRefBtn = $('use-as-ref-btn');
  const refLayer = $('ref-layer');
  const clearRefBtn = $('clear-ref-btn');

  const pressureDebug = $('pressure-debug');
  const pressureDebugBtn = $('pressure-debug-btn');
  const dbgPressure = $('dbg-pressure');
  const dbgTiltX = $('dbg-tiltx');
  const dbgTiltY = $('dbg-tilty');
  const dbgType = $('dbg-type');

  const settingsBtn = $('settings-open-btn');
  const settingsModal = $('settings-modal');
  const settingsSaveBtn = $('settings-save-btn');
  const settingsCloseBtn = $('settings-close-btn');
  const settingUrl = $('setting-url');
  const settingModel = $('setting-model');
  const settingControlnet = $('setting-controlnet');

  // ── Local Storage ────────────────────────────────────────────────────────

  function loadUIState() {
    const p = localStorage.getItem('drawler_prompt');
    if (p !== null) promptInput.value = p;

    const n = localStorage.getItem('drawler_negPrompt');
    if (n !== null) negPromptInput.value = n;

    const b = localStorage.getItem('drawler_brushSize');
    if (b !== null) { brushSizeInput.value = b; brushSizeVal.textContent = b; }

    const st = localStorage.getItem('drawler_steps');
    if (st !== null) { stepsInput.value = st; stepsVal.textContent = st; }

    const str = localStorage.getItem('drawler_strength');
    if (str !== null) { strengthInput.value = str; strengthVal.textContent = (str / 100).toFixed(2); }

    const cfg = localStorage.getItem('drawler_cfg');
    if (cfg !== null) { cfgInput.value = cfg; cfgVal.textContent = (cfg / 10).toFixed(1); }
  }

  function saveUIState() {
    localStorage.setItem('drawler_prompt', promptInput.value);
    localStorage.setItem('drawler_negPrompt', negPromptInput.value);
    localStorage.setItem('drawler_brushSize', brushSizeInput.value);
    localStorage.setItem('drawler_steps', stepsInput.value);
    localStorage.setItem('drawler_strength', strengthInput.value);
    localStorage.setItem('drawler_cfg', cfgInput.value);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    loadUIState();
    DrawingCanvas.init();

    promptInput.addEventListener('input', saveUIState);
    negPromptInput.addEventListener('input', saveUIState);

    bindSliders();
    bindToolbar();
    bindGenerate();
    bindResultOverlay();
    bindPressureDebug();
    bindSettingsModal();

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
      saveUIState();
    });

    stepsInput.addEventListener('input', () => {
      stepsVal.textContent = stepsInput.value;
      saveUIState();
    });

    strengthInput.addEventListener('input', () => {
      strengthVal.textContent = (parseInt(strengthInput.value, 10) / 100).toFixed(2);
      saveUIState();
    });

    cfgInput.addEventListener('input', () => {
      cfgVal.textContent = (parseInt(cfgInput.value, 10) / 10).toFixed(1);
      saveUIState();
    });
  }

  // ── Toolbar buttons ───────────────────────────────────────────────────────

  function bindToolbar() {
    clearBtn.addEventListener('click', () => {
      if (DrawingCanvas.isEmpty()) return;
      if (confirm('Clear the canvas?')) {
        DrawingCanvas.clear();
        clearRef();
      }
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
      const negPrompt = negPromptInput.value.trim() || 'blurry, bad quality, artifacts, jpeg noise';
      const steps = parseInt(stepsInput.value, 10);
      const strength = parseInt(strengthInput.value, 10) / 100;
      const cfg = parseInt(cfgInput.value, 10) / 10;

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
      // Display the generated image as a semi-transparent reference layer behind the canvas
      refLayer.src = resultImg.src;
      refLayer.classList.remove('hidden');
      clearRefBtn.classList.remove('hidden');

      hideResult();
      setStatus('Reference overlay active — draw on top of it.', 1);
      setTimeout(hideStatus, 3000);
    });

    clearRefBtn.addEventListener('click', clearRef);
  }

  function clearRef() {
    refLayer.src = '';
    refLayer.classList.add('hidden');
    clearRefBtn.classList.add('hidden');
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
      dbgTiltX.textContent = tiltX ?? '—';
      dbgTiltY.textContent = tiltY ?? '—';
      dbgType.textContent = type ?? '—';
    });
  }

  // ── Settings Modal ─────────────────────────────────────────────────────────

  function bindSettingsModal() {
    settingsBtn.addEventListener('click', () => {
      const config = SwarmAPI.getConfig();
      settingUrl.value = config.baseURL;
      settingModel.value = config.model;
      settingControlnet.value = config.controlnetModel;
      settingsModal.classList.remove('hidden');
    });

    const closeSettings = () => settingsModal.classList.add('hidden');

    settingsCloseBtn.addEventListener('click', closeSettings);
    settingsModal.addEventListener('click', e => {
      if (e.target === settingsModal) closeSettings();
    });

    settingsSaveBtn.addEventListener('click', () => {
      const baseURL = settingUrl.value.trim();
      const model = settingModel.value.trim();
      const controlnetModel = settingControlnet.value.trim();

      SwarmAPI.updateConfig({ baseURL, model, controlnetModel });

      localStorage.setItem('drawler_api_url', baseURL);
      localStorage.setItem('drawler_model', model);
      localStorage.setItem('drawler_controlnet', controlnetModel);

      closeSettings();
      checkSwarm(); // re-check connectivity after change
    });
  }

  // ── SwarmUI connectivity check ─────────────────────────────────────────────

  async function checkSwarm() {
    const hint = document.getElementById('config-hint');
    hint.innerHTML = 'Checking SwarmUI status…';
    try {
      const ok = await SwarmAPI.checkConnectivity();
      if (ok) {
        hint.innerHTML = 'SwarmUI <span style="color:#50e0a0">connected</span>';
      } else {
        hint.innerHTML = 'SwarmUI <span style="color:#e09050">not reachable</span> — check Settings';
      }
    } catch {
      hint.innerHTML = 'SwarmUI <span style="color:#e05050">offline</span> — check Settings';
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
