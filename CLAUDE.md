---
name: drawler-setup
description: >
  Use this skill to set up the Drawler project — an AI-native web-based drawing application
  that integrates with SwarmUI for real-time image generation via ControlNet. Triggers when
  the user wants to initialise the Drawler project, set up the development environment, fetch
  SwarmUI, check JS dependencies, or scaffold the project structure. Use this skill whenever
  the user mentions 'drawler', 'project setup', 'initialise drawler', 'SwarmUI setup', or
  asks about the JS dev environment for this project.
---

# Drawler Project Setup

Drawler is a browser-based pressure-sensitive drawing application that sends canvas sketches
to a local SwarmUI instance for AI image generation via Z-Image Turbo + ControlNet Union.

**Target environment:** Debian/Ubuntu Linux (development machine with NVIDIA GPU)  
**Access device:** iPad via local WiFi (browser-based, no app install)  
**Serving:** Python `http.server` during development — no Nginx or Docker required yet  

---

## Step 1 — Create project folder and initialise Git

```bash
mkdir -p ~/projects/drawler
cd ~/projects/drawler
git init
echo "# Drawler" > README.md
echo "A browser-based AI-native drawing app connecting to SwarmUI." >> README.md

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
*.log
swarmui/
models/
outputs/
__pycache__/
.DS_Store
EOF

git add .
git commit -m "chore: initial commit"
```

> **Note:** SwarmUI is excluded from git via `.gitignore` — it's a large external dependency,
> not part of the app source. Models and outputs are also excluded for the same reason.

---

## Step 2 — Fetch SwarmUI

SwarmUI is fetched separately into the project directory but not tracked by git.

```bash
cd ~/projects/drawler

# Clone SwarmUI
git clone https://github.com/mcmonkeyprojects/SwarmUI swarmui

# Run the install script (handles Python venv, ComfyUI backend, dependencies)
cd swarmui
bash install-linux.sh
```

### Post-install check

Verify SwarmUI starts and can see your GPU:

```bash
bash launch-linux.sh --port 7801
```

Open `http://localhost:7801` in browser and confirm the GPU is listed in the backend status.
If GPU is not detected, check NVIDIA drivers: `nvidia-smi` should return device info.

### SwarmUI launch flags useful for Drawler

```bash
# Allow access from iPad on local network
bash launch-linux.sh --port 7801 --host 0.0.0.0
```

> **Security note:** `--host 0.0.0.0` binds to all interfaces. Fine on a trusted home network,
> not for public exposure. Add a note to README when enabling this.

---

## Step 3 — Assess the JS development environment

Drawler's frontend is **vanilla JS + HTML5 Canvas** running entirely in the browser.
No build step, no compilation, no framework. This means:

**Node.js is NOT required** for running the app. However, it is useful for:
- `npm` to pull in Perfect Freehand as a local dependency (optional — can also use CDN)
- A slightly nicer dev server (`npx serve`) with proper MIME types vs Python's http.server
- Future tooling if the project grows (bundler, linter)

### Check what's already installed

```bash
node --version    # Check if Node is present
npm --version     # Check npm
python3 --version # Fallback dev server
```

### Decision tree

| Scenario | Recommendation |
|----------|---------------|
| Node already installed | Use it — `npx serve` is nicer than Python http.server |
| Node not installed, want minimal setup | Python http.server is sufficient to start |
| Want Perfect Freehand locally (no CDN) | Install Node, `npm init` and `npm install perfect-freehand` |

### Install Node if needed (via nvm — preferred over apt)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
node --version
```

---

## Step 4 — Project structure

Scaffold the frontend directory:

```bash
cd ~/projects/drawler

mkdir -p app/js app/css app/assets

# Entry point
touch app/index.html
touch app/js/canvas.js      # Drawing engine, Pointer Events, stroke smoothing
touch app/js/api.js         # SwarmUI API bridge
touch app/js/ui.js          # Controls, prompt input, parameter sliders
touch app/css/style.css

git add app/
git commit -m "chore: scaffold frontend structure"
```

### Resulting structure

```
drawler/
├── README.md
├── .gitignore
├── app/
│   ├── index.html
│   ├── js/
│   │   ├── canvas.js       # Pointer Events, Perfect Freehand, stroke rendering
│   │   ├── api.js          # SwarmUI REST calls, image encode/decode
│   │   └── ui.js           # UI state, controls, prompt, parameters
│   └── css/
│       └── style.css
└── swarmui/                # Not tracked by git
```

---

## Step 5 — Required packages and CDN links

### Browser-side (no install needed — use CDN during development)

Add to `app/index.html`:

```html
<!-- Perfect Freehand — pressure-aware stroke rendering -->
<script src="https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.2/dist/perfect-freehand.min.js"></script>
```

Perfect Freehand is the only external JS dependency for the core drawing experience.
Everything else (Pointer Events API, Canvas 2D, Fetch API) is native browser.

### If using npm instead of CDN

```bash
cd ~/projects/drawler
npm init -y
npm install perfect-freehand
```

Then reference locally in index.html or import in JS modules.

### Python packages (for dev server and future SwarmUI scripting)

```bash
# Minimal — just the dev server (already have Python)
# No pip installs needed for basic development

# Optional: if you want to script SwarmUI API calls from Python later
pip install requests pillow --break-system-packages
```

### Verify SwarmUI API is reachable

Quick sanity check that your JS app will be able to talk to SwarmUI:

```bash
curl http://localhost:7801/API/GetNewSession \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}'
```

Should return a JSON object with a `session_id`. If it does, the API bridge in `api.js`
has something to talk to.

---

## Step 6 — Start the dev server

```bash
cd ~/projects/drawler/app

# Option A: Python (no Node required)
python3 -m http.server 8080

# Option B: Node (nicer — proper MIME types, no caching issues)
npx serve -p 8080
```

Open on desktop: `http://localhost:8080`  
Open on iPad: `http://<your-machine-local-ip>:8080`

Find your local IP:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
# or
hostname -I | awk '{print $1}'
```

---

## Quick reference — SwarmUI API endpoints used by Drawler

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/API/GetNewSession` | POST | Get session ID |
| `/API/GenerateText2Image` | POST | Text to image |
| `/API/GenerateImage2Image` | POST | img2img / ControlNet input |
| `/API/GetCurrentStatus` | POST | Poll generation progress |

Full SwarmUI API docs: `http://localhost:7801/Text2Image` → Developer tab, or see
`swarmui/docs/API.md` after cloning.

---

## Notes and gotchas

**Pointer Events on iPad Safari** — test pressure input early with a minimal logger
before building on top of it. Safari's Pointer Events implementation is slightly behind
Chrome. A quick test:

```javascript
canvas.addEventListener('pointermove', e => {
  console.log('pressure:', e.pressure, 'tiltX:', e.tiltX, 'tiltY:', e.tiltY);
});
```

**SwarmUI CORS** — when serving the app from `http://localhost:8080` and calling
`http://localhost:7801`, you may hit CORS errors. Workarounds in order of preference:
1. Launch SwarmUI with `--cors-origins http://localhost:8080`
2. Use a simple Python proxy script during dev
3. Add Nginx later when ready (see future infrastructure notes in README)

**iPad local IP** — if your machine's local IP changes (DHCP), you'll need to update
the SwarmUI endpoint in `api.js`. Consider setting a static local IP on your router
for the dev machine, or use a `.env`-style config at the top of `api.js`.