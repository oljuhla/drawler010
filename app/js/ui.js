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
  const saveSketchBtn = $('save-sketch-btn');
  const importImgBtn = $('import-img-btn');
  const importImgInput = $('import-img-input');

  const brushSizeInput = $('brush-size');
  const brushSizeVal = $('brush-size-val');
  const brushColorInput = $('brush-color');
  const brushPreview = $('brush-preview');

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
  const copyBtn = $('copy-result-btn');
  const saveBtn = $('save-btn');
  const useAsRefBtn = $('use-as-ref-btn');
  const refLayer = $('ref-layer');
  const clearRefBtn = $('clear-ref-btn');
  const refOpacityInput = $('ref-opacity');

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
  const refreshModelsBtn = $('refresh-models-btn');
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

    const c = localStorage.getItem('drawler_brushColor');
    if (c !== null) brushColorInput.value = c;

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
    localStorage.setItem('drawler_brushColor', brushColorInput.value);
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
    updateBrush();

    // Check SwarmUI connectivity (non-blocking)
    checkSwarm();
  }

  // ── Sliders / Inputs ──────────────────────────────────────────────────────

  function updateBrush() {
    const size = parseInt(brushSizeInput.value, 10);
    const color = brushColorInput.value;
    DrawingCanvas.setOptions({ size, color });

    // Update visual preview
    brushPreview.style.width = size + 'px';
    brushPreview.style.height = size + 'px';
    brushPreview.style.background = color;
  }

  function bindSliders() {
    brushSizeInput.addEventListener('input', () => {
      brushSizeVal.textContent = brushSizeInput.value;
      updateBrush();
      saveUIState();
    });

    brushColorInput.addEventListener('input', () => {
      updateBrush();
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

    saveSketchBtn.addEventListener('click', () => {
      if (DrawingCanvas.isEmpty()) return;
      const a = document.createElement('a');
      a.href = DrawingCanvas.exportDataURL();
      a.download = 'sketch-' + Date.now() + '.png';
      a.click();
    });

    importImgBtn.addEventListener('click', () => {
      importImgInput.value = '';   // allow re-selecting the same file
      importImgInput.click();
    });

    importImgInput.addEventListener('change', () => {
      const file = importImgInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        refLayer.src = e.target.result;
        showRef();
        setStatus('Reference image loaded — draw on top of it.', 1);
        setTimeout(hideStatus, 3000);
      };
      reader.readAsDataURL(file);
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

    copyBtn.addEventListener('click', async () => {
      if (!resultImg.src) return;
      try {
        const response = await fetch(resultImg.src);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        setStatus('Copied to clipboard! Switch to Procreate and Paste.', 1);
        setTimeout(hideStatus, 3000);
      } catch (err) {
        console.error('[ui] Copy failed:', err);
        setStatus('Copy failed. Try saving instead.', 0);
        setTimeout(hideStatus, 3000);
      }
    });

    saveBtn.addEventListener('click', async () => {
      if (!resultImg.src) return;

      // If supported (iOS Safari 15+), use the native Share Sheet
      if (navigator.share) {
        try {
          const response = await fetch(resultImg.src);
          const blob = await response.blob();
          const file = new File([blob], 'drawler-' + Date.now() + '.png', { type: 'image/png' });

          await navigator.share({
            files: [file],
            title: 'Drawler Generation',
          });
        } catch (err) {
          // Fallback if share is cancelled or fails
          console.log('[ui] Share cancelled or failed:', err);
          downloadFallback();
        }
      } else {
        downloadFallback();
      }
    });

    function downloadFallback() {
      const a = document.createElement('a');
      a.href = resultImg.src;
      a.download = 'drawler-' + Date.now() + '.png';
      a.click();
    }

    useAsRefBtn.addEventListener('click', () => {
      // Display the generated image as a semi-transparent reference layer behind the canvas
      refLayer.src = resultImg.src;
      showRef();

      hideResult();
      setStatus('Reference overlay active — draw on top of it.', 1);
      setTimeout(hideStatus, 3000);
    });

    clearRefBtn.addEventListener('click', clearRef);

    refOpacityInput.addEventListener('input', () => {
      refLayer.style.opacity = parseInt(refOpacityInput.value, 10) / 100;
    });
  }

  function showRef() {
    refLayer.classList.remove('hidden');
    refOpacityInput.classList.remove('hidden');
    clearRefBtn.classList.remove('hidden');
    // Sync opacity to current slider value (in case it changed since last use)
    refLayer.style.opacity = parseInt(refOpacityInput.value, 10) / 100;
  }

  function clearRef() {
    refLayer.src = '';
    refLayer.classList.add('hidden');
    refOpacityInput.classList.add('hidden');
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
      settingControlnet.value = config.controlnetModel;
      settingsModal.classList.remove('hidden');  // open immediately — select shows "(Loading models...)"
      fetchModels(config.model);                 // populate async in background
    });

    const closeSettings = () => settingsModal.classList.add('hidden');

    settingsCloseBtn.addEventListener('click', closeSettings);
    settingsModal.addEventListener('click', e => {
      if (e.target === settingsModal) closeSettings();
    });

    refreshModelsBtn.addEventListener('click', async () => {
      refreshModelsBtn.disabled = true;
      const current = settingModel.value;
      await fetchModels(current);
      refreshModelsBtn.disabled = false;
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

  async function fetchModels(currentValue) {
    settingModel.innerHTML = '<option value="">(Loading models...)</option>';
    try {
      const models = await SwarmAPI.listModels();
      if (models && models.length > 0) {
        settingModel.innerHTML = '';
        models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          if (m === currentValue) opt.selected = true;
          settingModel.appendChild(opt);
        });
      } else {
        settingModel.innerHTML = '<option value="">(No models found)</option>';
        if (currentValue) {
           const opt = document.createElement('option');
           opt.value = currentValue;
           opt.textContent = currentValue;
           opt.selected = true;
           settingModel.appendChild(opt);
        }
      }
    } catch (err) {
      console.error('[ui] Failed to fetch models:', err);
      settingModel.innerHTML = '<option value="">Error loading models</option>';
    }
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
