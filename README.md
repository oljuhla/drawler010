# Drawler

A browser-based AI-native drawing app connecting to SwarmUI.

Pressure-sensitive canvas → SwarmUI (Z-Image Turbo + ControlNet Union) → generated image.

## Quick start

```bash
# Serve the app
cd app
python3 -m http.server 8080

# Open on desktop
open http://localhost:8080

# Open on iPad — find your machine's local IP first
ip addr show | grep "inet " | grep -v 127.0.0.1
# Then open http://<your-ip>:8080
```

## SwarmUI

SwarmUI must be running separately. It is not tracked in this repo.

```bash
# Start SwarmUI (allow iPad access)
cd swarmui
bash launch-linux.sh --port 7801 --host 0.0.0.0 --cors-origins http://<your-ip>:8080
```

## Configuration

Edit `app/js/api.js` top section to set:
- `BASE_URL` — SwarmUI host (default `http://localhost:7801`)
- `MODEL` — exact model name as it appears in SwarmUI
- `CONTROLNET_TYPE` — ControlNet Union mode (default `scribble`)

## Stack

- Vanilla JS + HTML5 Canvas — no build step
- [Perfect Freehand](https://github.com/steveruizok/perfect-freehand) — pressure-sensitive stroke rendering (CDN)
- Pointer Events API — pressure, tilt from Apple Pencil
- SwarmUI REST API — image generation backend
