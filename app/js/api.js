/**
 * api.js — SwarmUI bridge
 *
 * Connects to a locally running SwarmUI instance and submits the canvas
 * sketch as a ControlNet input for AI image generation.
 *
 * ── CONFIGURATION ──────────────────────────────────────────────────────────
 *
 * Edit the CONFIG block below to match your setup.
 *
 * MODEL: The exact model filename as it appears in SwarmUI's model dropdown
 *        (without extension, typically).  e.g. "juggernautXL_v9Rundiffusionphoto2"
 *        For Z-Image Turbo check the exact name in your SwarmUI models folder.
 *
 * CONTROLNET_MODEL: The ControlNet Union model name in SwarmUI.
 *
 * CONTROLNET_TYPE:  The control type string. Common options:
 *                   "scribble"  — for rough sketches
 *                   "lineart"   — for clean line drawings
 *                   "depth"     — for depth maps
 *                   Check your SwarmUI ControlNet node for accepted values.
 *
 * NOTE on CORS: SwarmUI must be launched with:
 *   --cors-origins http://<your-machine-ip>:8080
 *   (or the exact origin you're serving the app from)
 *
 * ── API NOTES ──────────────────────────────────────────────────────────────
 *
 * SwarmUI's REST API returns results synchronously for simple requests, but
 * for generation it may stream progress via GetCurrentStatus polling.
 * The exact parameter names here are based on the SwarmUI API as of 2024.
 * If generation fails, open SwarmUI's Developer tab (Text2Image page) to
 * inspect the exact payload format it sends internally.
 *
 * Useful: swarmui/docs/API.md after cloning SwarmUI.
 */

;(function () {
  'use strict';

  // ── CONFIG — edit these before first use ──────────────────────────────────

  const CONFIG = {
    // SwarmUI host. Use your machine's LAN IP when accessing from iPad.
    baseURL: 'http://localhost:7801',

    // Exact model name as shown in SwarmUI (no path, no extension needed for most setups)
    // TODO: Replace with actual model name after SwarmUI is running
    model: 'YOUR_MODEL_NAME_HERE',

    // ControlNet model name (as listed in SwarmUI's ControlNet dropdown)
    // TODO: Replace with actual ControlNet Union model name
    controlnetModel: 'YOUR_CONTROLNET_MODEL_HERE',

    // ControlNet type / preprocessor hint
    // Typical value for sketches: "scribble"
    controlnetType: 'scribble',

    // Generation canvas resolution (must match canvas.js EXPORT_SIZE)
    width: 1024,
    height: 1024,

    // How often to poll for status (ms)
    pollInterval: 600,

    // Max time to wait for generation before giving up (ms)
    pollTimeout: 120_000,
  };

  // ── State ─────────────────────────────────────────────────────────────────

  let sessionId = null;

  // ── Session ───────────────────────────────────────────────────────────────

  async function getSession() {
    if (sessionId) return sessionId;

    const res = await fetchSwarm('/API/GetNewSession', {});
    if (!res.session_id) throw new Error('SwarmUI did not return a session_id');
    sessionId = res.session_id;
    return sessionId;
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  /**
   * Submit a generation request.
   *
   * @param {string} imageBase64  - base64 PNG of the drawing (no data: prefix)
   * @param {string} prompt       - positive prompt
   * @param {string} negPrompt    - negative prompt
   * @param {object} opts         - { steps, strength, cfg }
   * @param {function} onProgress - called with (fraction 0-1, statusText) during polling
   * @returns {Promise<string>}   - base64 PNG of the generated image (data URL)
   */
  async function generate(imageBase64, prompt, negPrompt, opts, onProgress) {
    const sid = await getSession();
    const { steps = 6, strength = 0.85, cfg = 1.0 } = opts;

    // ── Build the generation payload ────────────────────────────────────────
    //
    // SwarmUI's GenerateImage2Image endpoint accepts a JSON body that mirrors
    // what you'd set in the UI.  The exact keys below match the SwarmUI API.
    //
    // The ControlNet input is embedded as a base64 image in the "initimage"
    // field with controlnet-specific params alongside it.
    //
    // TODO: Verify these parameter names by checking:
    //   1. swarmui/docs/API.md
    //   2. SwarmUI UI → Developer tab → copy payload from a test generation
    //
    const payload = {
      session_id: sid,
      prompt,
      negativeprompt: negPrompt,
      model: CONFIG.model,
      steps,
      cfgscale: cfg,
      width: CONFIG.width,
      height: CONFIG.height,
      seed: -1,              // -1 = random seed

      // ControlNet / init image params
      // These names follow the SwarmUI parameter convention as of v0.9
      // The init image doubles as the ControlNet input here
      initimage: imageBase64,
      init_image_creativity: 1 - strength,  // SwarmUI's term for denoise strength (inverted)

      // ControlNet-specific parameters
      // The exact structure depends on SwarmUI's ControlNet node
      controlnetstrength: strength,
      controlnetmodel: CONFIG.controlnetModel,
      controlnetimagetype: CONFIG.controlnetType,
    };

    const result = await fetchSwarm('/API/GenerateImage2Image', payload);

    // ── Handle immediate result or async task ─────────────────────────────
    //
    // SwarmUI may return images directly in the response, or return a
    // "waiting" status with a gen_progress that we need to poll.
    //
    if (result.images && result.images.length > 0) {
      // Synchronous result
      return imageResultToDataURL(result.images[0]);
    }

    if (result.error) {
      throw new Error('SwarmUI error: ' + result.error);
    }

    // Poll for async completion
    return pollForResult(sid, onProgress);
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  async function pollForResult(sid, onProgress) {
    const deadline = Date.now() + CONFIG.pollTimeout;

    while (Date.now() < deadline) {
      await sleep(CONFIG.pollInterval);

      const status = await fetchSwarm('/API/GetCurrentStatus', {
        session_id: sid,
      });

      if (status.error) throw new Error('SwarmUI error: ' + status.error);

      // Report progress
      if (typeof onProgress === 'function') {
        const fraction = status.overall_percent ?? status.progress ?? 0;
        const text = status.waiting_gens != null
          ? `Step ${status.current_step ?? '?'} / ${status.total_steps ?? '?'}`
          : 'Generating…';
        onProgress(fraction, text);
      }

      // Check for completion
      if (status.current_waiting_gens === 0 && status.results?.length > 0) {
        return imageResultToDataURL(status.results[0]);
      }

      // Some SwarmUI versions put finished images in status.images
      if (status.done && status.images?.length > 0) {
        return imageResultToDataURL(status.images[0]);
      }
    }

    throw new Error('Generation timed out — SwarmUI did not complete in time.');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Normalise a SwarmUI image result to a data URL.
   * Results may be: a data URL already, a bare base64 string, or a relative path.
   */
  function imageResultToDataURL(img) {
    if (!img) throw new Error('No image in result');

    if (typeof img === 'string') {
      if (img.startsWith('data:')) return img;
      // Relative URL → absolute (SwarmUI serves images from its own server)
      if (img.startsWith('/')) return CONFIG.baseURL + img;
      // Bare base64
      return 'data:image/png;base64,' + img;
    }

    // Object with a "image" field (some SwarmUI versions)
    if (img.image) return imageResultToDataURL(img.image);

    throw new Error('Unrecognised image result format: ' + JSON.stringify(img).slice(0, 120));
  }

  async function fetchSwarm(path, body) {
    const res = await fetch(CONFIG.baseURL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`SwarmUI HTTP ${res.status} on ${path}`);
    }

    return res.json();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Connectivity check ────────────────────────────────────────────────────

  /**
   * Quick ping to verify SwarmUI is reachable.
   * @returns {Promise<boolean>}
   */
  async function checkConnectivity() {
    try {
      const res = await fetchSwarm('/API/GetNewSession', {});
      return !!res.session_id;
    } catch {
      return false;
    }
  }

  // ── Expose ────────────────────────────────────────────────────────────────

  window.SwarmAPI = {
    generate,
    checkConnectivity,
    getConfig: () => ({ ...CONFIG }),
    setBaseURL: (url) => {
      CONFIG.baseURL = url.replace(/\/$/, '');
      sessionId = null;  // reset session when URL changes
    },
  };

}());
