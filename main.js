import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

/* =========================
   CONFIG
========================= */
const CONFIG = {
  cellSize: 2,
  wallHeight: 1.6,
  wallSize: 2,

  playerRadius: 0.45,
  playerY: 0.45,

  // Movement feel (ENHANCED)
  moveMaxSpeed: 7.5,
  moveAccel: 32.0,
  moveDecel: 28.0,
  moveTurnBoost: 14.0,

  // Top cam
  topCamHeight: 40,
  orthoPadding: 1.12,

  // FPS
  fpsEyeHeight: 0.75,
  fpsFov: 75,
  fpsPitchLimit: 1.15,

  winDistance: 0.9,
  maxPixelRatio: 2,

  // Levels
  startLevel: 1,
  maxLevel: Number.POSITIVE_INFINITY,
  maxMazeOddSize: 41,
  baseMazeOddSize: 11,
  sizeGrowEveryLevel: 2,
  loopChanceBase: 0.04,
  loopChanceGrow: 0.01,

  // Audio
  audioEnabled: true,
  stepIntervalMs: 200,
  bumpCooldownMs: 100,

  // Visual FX
  ambientParticles: true,
  trailEffect: true,
  glowIntensity: 1.2,
  cameraShake: true,
  transitionTime: 800,
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function makeOdd(n) { return (n % 2 === 0) ? n + 1 : n; }
function lerp(a, b, t) { return a + (b - a) * t; }

/* =========================
   DOM
========================= */
const ui = {
  status: document.getElementById("status"),
  mode: document.getElementById("mode"),
  hint: document.getElementById("hint"),
  crosshair: document.getElementById("crosshair"),
  winOverlay: document.getElementById("winOverlay"),
  restartBtn: document.getElementById("restartBtn"),

  btnCam: document.getElementById("btnCam"),
  btnUp: document.getElementById("btnUp"),
  btnDown: document.getElementById("btnDown"),
  btnLeft: document.getElementById("btnLeft"),
  btnRight: document.getElementById("btnRight"),

  levelText: document.getElementById("levelText"),
  nextBtn: document.getElementById("nextBtn"),
};

/* =========================
   INPUT
========================= */
const input = { up: false, down: false, left: false, right: false };

function resetInput() {
  input.up = input.down = input.left = input.right = false;
}

function bindHoldButton(el, key) {
  if (!el) return;

  const onDown = (e) => { e.preventDefault(); input[key] = true; };
  const onUp = (e) => { e.preventDefault(); input[key] = false; };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("pointerleave", onUp);
}

bindHoldButton(ui.btnUp, "up");
bindHoldButton(ui.btnDown, "down");
bindHoldButton(ui.btnLeft, "left");
bindHoldButton(ui.btnRight, "right");

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w" || k === "arrowup") input.up = true;
  if (k === "s" || k === "arrowdown") input.down = true;
  if (k === "a" || k === "arrowleft") input.left = true;
  if (k === "d" || k === "arrowright") input.right = true;

  if (k === "c") toggleCameraMode();
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w" || k === "arrowup") input.up = false;
  if (k === "s" || k === "arrowdown") input.down = false;
  if (k === "a" || k === "arrowleft") input.left = false;
  if (k === "d" || k === "arrowright") input.right = false;
});

window.addEventListener("blur", resetInput);
document.addEventListener("visibilitychange", () => { if (document.hidden) resetInput(); });

/* =========================
   AUDIO (ENHANCED)
========================= */
const AudioFX = (() => {
  let ctx = null;
  let master = null;

  let stepTimer = 0;
  let stepping = false;
  let lastBumpAt = 0;

  function ensure() {
    if (!CONFIG.audioEnabled) return;
    if (ctx) return;

    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
  }

  function userGestureUnlock() {
    ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function tone(freq, durationMs, type = "sine", gain = 0.35) {
    if (!CONFIG.audioEnabled) return;
    ensure();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);

    osc.connect(g);
    g.connect(master);

    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.02);
  }

  function click() { tone(580, 45, "square", 0.24); }
  
  function win() {
    // More pleasant win sound
    tone(440, 100, "sine", 0.25);
    setTimeout(() => tone(554, 120, "sine", 0.28), 100);
    setTimeout(() => tone(659, 140, "sine", 0.30), 230);
    setTimeout(() => tone(880, 180, "sine", 0.32), 380);
  }

  function bump() {
    const now = performance.now();
    if (now - lastBumpAt < CONFIG.bumpCooldownMs) return;
    lastBumpAt = now;
    tone(140, 50, "sawtooth", 0.18);
  }

  function startSteps() {
    if (stepping) return;
    stepping = true;
    stepTimer = 0;
  }

  function stopSteps() { stepping = false; }

  function update(dt) {
    if (!stepping) return;
    stepTimer += dt * 1000;
    if (stepTimer >= CONFIG.stepIntervalMs) {
      stepTimer = 0;
      tone(240 + Math.random() * 40, 28, "triangle", 0.09);
    }
  }

  return { userGestureUnlock, click, win, bump, startSteps, stopSteps, update };
})();

window.addEventListener("pointerdown", () => AudioFX.userGestureUnlock(), { once: true });
window.addEventListener("keydown", () => AudioFX.userGestureUnlock(), { once: true });

/* =========================
   LEVEL SYSTEM + GENERATOR
========================= */
function generateMaze(level) {
  const raw = CONFIG.baseMazeOddSize + (level - 1) * CONFIG.sizeGrowEveryLevel;
  const size = makeOdd(Math.min(raw, CONFIG.maxMazeOddSize));
  const rows = size;
  const cols = size;

  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [];

  const startR = 1, startC = 1;
  stack.push([startR, startC]);
  visited[startR][startC] = true;
  grid[startR][startC] = 0;

  const dirs = [[-2,0],[2,0],[0,-2],[0,2]];

  function inBounds(r, c) {
    return r > 0 && c > 0 && r < rows - 1 && c < cols - 1;
  }

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];

    for (let i = dirs.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = dirs[i]; dirs[i] = dirs[j]; dirs[j] = tmp;
    }

    let moved = false;
    for (let i = 0; i < dirs.length; i++) {
      const nr = r + dirs[i][0];
      const nc = c + dirs[i][1];
      if (!inBounds(nr, nc) || visited[nr][nc]) continue;

      visited[nr][nc] = true;
      grid[nr][nc] = 0;

      const wr = r + dirs[i][0] / 2;
      const wc = c + dirs[i][1] / 2;
      grid[wr][wc] = 0;

      stack.push([nr, nc]);
      moved = true;
      break;
    }

    if (!moved) stack.pop();
  }

  const loopChance = clamp(
    CONFIG.loopChanceBase + (level - 1) * CONFIG.loopChanceGrow,
    0.04,
    0.22
  );

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] !== 1) continue;

      const left = grid[r][c - 1] === 0;
      const right = grid[r][c + 1] === 0;
      const up = grid[r - 1][c] === 0;
      const down = grid[r + 1][c] === 0;

      const horizontalBridge = left && right && !up && !down;
      const verticalBridge = up && down && !left && !right;

      if ((horizontalBridge || verticalBridge) && Math.random() < loopChance) {
        grid[r][c] = 0;
      }
    }
  }

  const start = { r: 1, c: 1 };
  const goal = { r: rows - 2, c: cols - 2 };
  grid[goal.r][goal.c] = 0;

  return { grid, rows, cols, start, goal };
}

const LevelManager = (() => {
  const KEY = "maze3d_progress_v2";
  let currentLevel = Math.max(1, CONFIG.startLevel);
  let bestLevel = currentLevel;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.best && typeof data.best === "number") bestLevel = data.best;
      if (bestLevel < 1) bestLevel = 1;
    } catch {}
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ best: bestLevel }));
    } catch {}
  }

  function updateUI() {
    if (ui.levelText) {
      ui.levelText.textContent = `Level ${currentLevel} | Best ${bestLevel}`;
    }
  }

  load();

  return {
    getLevel: () => currentLevel,
    getBest: () => bestLevel,
    nextLevel() {
      currentLevel++;
      if (currentLevel > CONFIG.maxLevel) currentLevel = CONFIG.maxLevel;
      if (currentLevel > bestLevel) {
        bestLevel = currentLevel;
        save();
      }
      updateUI();
    },
    restart() {
      updateUI();
    },
    updateUI,
  };
})();

/* =========================
   SCENE + RENDERER
========================= */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const TOP_BG_COLOR = new THREE.Color(0x1a2332);

// Simple skybox (no external assets): canvas gradient + subtle stars.
// We only show it in FPS mode so top-down stays super clear.
function createSkyTexture() {
  const w = 1024;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");

  // Vertical gradient sky
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0.0, "#0b1220");
  grd.addColorStop(0.55, "#101b2f");
  grd.addColorStop(1.0, "#1a2b45");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);

  // Subtle stars (kept very low contrast)
  const starCount = 350;
  for (let i = 0; i < starCount; i++) {
    const x = Math.random() * w;
    const y = Math.random() * (h * 0.65);
    const r = Math.random() < 0.85 ? 0.7 : 1.2;
    const a = 0.05 + Math.random() * 0.12;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // Slight vignette to keep focus toward center
  const vg = g.createRadialGradient(w * 0.5, h * 0.55, h * 0.2, w * 0.5, h * 0.55, h * 0.85);
  vg.addColorStop(0.0, "rgba(0,0,0,0.0)");
  vg.addColorStop(1.0, "rgba(0,0,0,0.35)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const SKY_TEX = createSkyTexture();
scene.background = TOP_BG_COLOR;

// Enhanced ambient light (lift dark areas without fog)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambientLight);

// Hemisphere fill light keeps corners readable and reduces harsh contrast
const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0b1020, 0.35);
scene.add(hemiLight);

// Main directional light with shadows
const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
mainLight.position.set(8, 16, 8);
mainLight.castShadow = true;
mainLight.shadow.camera.left = -25;
mainLight.shadow.camera.right = 25;
mainLight.shadow.camera.top = 25;
mainLight.shadow.camera.bottom = -25;
mainLight.shadow.camera.near = 0.1;
mainLight.shadow.camera.far = 50;
mainLight.shadow.mapSize.width = 2048;
mainLight.shadow.mapSize.height = 2048;
// Softer / more stable shadows (reduce acne + edge shimmer)
mainLight.shadow.bias = -0.0002;
mainLight.shadow.normalBias = 0.02;
mainLight.shadow.radius = 2;
scene.add(mainLight);

// Mobile perf: smaller shadow maps
if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) {
  mainLight.shadow.mapSize.width = 1024;
  mainLight.shadow.mapSize.height = 1024;
}

// Fill light to soften shadows
const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
fillLight.position.set(-8, 10, -8);
scene.add(fillLight);

// Accent lights for atmosphere
const accentLight1 = new THREE.PointLight(0x818cf8, 1.0, 40);
accentLight1.position.set(-10, 10, -10);
scene.add(accentLight1);

const accentLight2 = new THREE.PointLight(0xfbbf24, 0.8, 35);
accentLight2.position.set(10, 8, 10);
scene.add(accentLight2);

/* =========================
   MATERIALS (ENHANCED)
========================= */
const textureLoader = new THREE.TextureLoader();

function makeNoiseCanvas(size, baseHex = "#2a3446", lineHex = "#344155") {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");

  g.fillStyle = baseHex;
  g.fillRect(0, 0, size, size);

  // Subtle grain
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  // Soft panel-ish lines
  g.strokeStyle = lineHex;
  g.lineWidth = 2;
  const step = size / 8;
  for (let i = 0; i <= size; i += step) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, size);
    g.stroke();
  }

  return c;
}

function makeAOCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");

  // Edge darkening to fake ambient occlusion
  const grd = g.createRadialGradient(size * 0.5, size * 0.5, size * 0.08, size * 0.5, size * 0.5, size * 0.72);
  grd.addColorStop(0, "rgba(255,255,255,1.0)");
  grd.addColorStop(0.65, "rgba(220,220,220,1.0)");
  grd.addColorStop(1, "rgba(140,140,140,1.0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

// Ground with grid texture
const groundCanvas = document.createElement('canvas');
groundCanvas.width = 512;
groundCanvas.height = 512;
const groundCtx = groundCanvas.getContext('2d');

// Darker base color for contrast
groundCtx.fillStyle = '#1e2938';
groundCtx.fillRect(0, 0, 512, 512);

// Grid lines
groundCtx.strokeStyle = '#374151';
groundCtx.lineWidth = 2;
const gridSize = 32;
for (let i = 0; i <= 512; i += gridSize) {
  groundCtx.beginPath();
  groundCtx.moveTo(i, 0);
  groundCtx.lineTo(i, 512);
  groundCtx.stroke();
  
  groundCtx.beginPath();
  groundCtx.moveTo(0, i);
  groundCtx.lineTo(512, i);
  groundCtx.stroke();
}

const groundTexture = new THREE.CanvasTexture(groundCanvas);
groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;

const aoTexture = new THREE.CanvasTexture(makeAOCanvas(256));
aoTexture.wrapS = aoTexture.wrapT = THREE.RepeatWrapping;
aoTexture.repeat.set(1, 1);

const groundMat = new THREE.MeshStandardMaterial({
  map: groundTexture,
  aoMap: aoTexture,
  aoMapIntensity: 0.45,
  roughness: 0.9,
  metalness: 0.0,
});

// Walls with enhanced look
const wallTexture = new THREE.CanvasTexture(makeNoiseCanvas(256, "#2b3a52", "#33445e"));
wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
wallTexture.repeat.set(1, 1);

const wallMat = new THREE.MeshStandardMaterial({
  // Slightly brighter + tiny emissive so walls don't crush to black
  color: 0x556b8a,
  map: wallTexture,
  aoMap: aoTexture,
  aoMapIntensity: 0.55,
  roughness: 0.7,
  metalness: 0.12,
  emissive: 0x0b1220,
  emissiveIntensity: 0.16,
  envMapIntensity: 0.35,
});

// Wall top edge highlight material
const wallTopMat = new THREE.MeshStandardMaterial({
  color: 0x5a6c89,
  emissive: 0x5a6c89,
  emissiveIntensity: 0.2,
  map: wallTexture,
  aoMap: aoTexture,
  aoMapIntensity: 0.65,
  roughness: 0.6,
  metalness: 0.3,
  // Extra insurance against z-fighting shimmering on edges
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

// Player ball with vibrant materials
const playerMat = new THREE.MeshStandardMaterial({
  color: 0x818cf8,
  emissive: 0x6366f1,
  emissiveIntensity: 0.8,
  roughness: 0.15,
  metalness: 0.4,
});

/* =========================
   GEOMETRIES
========================= */
const wallGeo = new THREE.BoxGeometry(CONFIG.wallSize, CONFIG.wallHeight, CONFIG.wallSize);
const wallTopGeo = new THREE.BoxGeometry(CONFIG.wallSize, 0.08, CONFIG.wallSize);
const playerGeo = new THREE.SphereGeometry(CONFIG.playerRadius, 32, 32);
const goalGeo = new THREE.CylinderGeometry(0.4, 0.45, 1.1, 32);

// Enable aoMap support
wallGeo.setAttribute("uv2", new THREE.BufferAttribute(wallGeo.attributes.uv.array, 2));
wallTopGeo.setAttribute("uv2", new THREE.BufferAttribute(wallTopGeo.attributes.uv.array, 2));

/* =========================
   WORLD OBJECTS
========================= */
let MAZE = [];
let mazeRows = 0, mazeCols = 0;
let worldW = 0, worldD = 0;
const WORLD_CENTER = new THREE.Vector3();

let ground = null;
let wallsInst = null;
let wallTopsInst = null;
let wallBoxes = [];
let goal = null;

let startPos = new THREE.Vector3();
let goalPos = new THREE.Vector3();

/* =========================
   PLAYER
========================= */
const player = new THREE.Mesh(playerGeo, playerMat);
player.castShadow = true;
player.receiveShadow = false;
scene.add(player);

const playerVel = new THREE.Vector3(0, 0, 0);
let lastMoveSpeed = 0;

// Player glow effect
const playerGlow = new THREE.PointLight(0x818cf8, 2.0, 5);
playerGlow.castShadow = false;
player.add(playerGlow);

/* =========================
   PARTICLE SYSTEM (NEW)
========================= */
class ParticleSystem {
  constructor() {
    this.particles = [];
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.PointsMaterial({
      color: 0x818cf8,
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    scene.add(this.points);
  }

  addParticle(pos, vel, life = 1.0) {
    this.particles.push({
      pos: pos.clone(),
      vel: vel.clone(),
      life: life,
      maxLife: life,
    });
  }

  update(dt) {
    this.particles = this.particles.filter(p => {
      p.life -= dt;
      if (p.life <= 0) return false;

      p.vel.y -= 2.0 * dt;
      p.pos.add(p.vel.clone().multiplyScalar(dt));
      return true;
    });

    const positions = new Float32Array(this.particles.length * 3);
    this.particles.forEach((p, i) => {
      positions[i * 3] = p.pos.x;
      positions[i * 3 + 1] = p.pos.y;
      positions[i * 3 + 2] = p.pos.z;
    });

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material.opacity = 0.7;
  }
}

const particleSystem = new ParticleSystem();

/* =========================
   TRAIL EFFECT (NEW)
========================= */
const trailPoints = [];
const trailGeometry = new THREE.BufferGeometry();
const trailMaterial = new THREE.LineBasicMaterial({
  color: 0x818cf8,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
});
const trailLine = new THREE.Line(trailGeometry, trailMaterial);
scene.add(trailLine);

function updateTrail() {
  if (!CONFIG.trailEffect) return;
  
  trailPoints.push(player.position.clone());
  if (trailPoints.length > 30) trailPoints.shift();

  const positions = new Float32Array(trailPoints.length * 3);
  trailPoints.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });

  trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
}

/* =========================
   WIN BURST PARTICLES (ENHANCED)
========================= */
const burstParticles = [];

function spawnWinBurst(pos) {
  const count = 60;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const speed = 3 + Math.random() * 2;
    const vx = Math.cos(angle) * speed;
    const vz = Math.sin(angle) * speed;
    const vy = 2 + Math.random() * 3;

    const geo = new THREE.SphereGeometry(0.08 + Math.random() * 0.06, 8, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: Math.random() > 0.5 ? 0xfbbf24 : 0x6366f1,
      emissive: Math.random() > 0.5 ? 0xf59e0b : 0x4f46e5,
      emissiveIntensity: 2.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);

    burstParticles.push({
      mesh,
      vel: new THREE.Vector3(vx, vy, vz),
      life: 1.5 + Math.random() * 0.5,
    });
  }
}

function updateBursts(dt) {
  for (let i = burstParticles.length - 1; i >= 0; i--) {
    const p = burstParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      burstParticles.splice(i, 1);
      continue;
    }

    p.vel.y -= 9.8 * dt;
    p.mesh.position.add(p.vel.clone().multiplyScalar(dt));

    const alpha = clamp(p.life / 0.5, 0, 1);
    p.mesh.material.opacity = alpha;
    p.mesh.material.transparent = true;
  }
}

/* =========================
   COLLISION
========================= */
function resolveSphereAABBCollisions(pos, rad) {
  let hitAny = false;
  for (let box of wallBoxes) {
    const closest = new THREE.Vector3(
      clamp(pos.x, box.min.x, box.max.x),
      clamp(pos.y, box.min.y, box.max.y),
      clamp(pos.z, box.min.z, box.max.z)
    );

    const dist = pos.distanceTo(closest);
    if (dist < rad) {
      const pushDir = pos.clone().sub(closest);
      if (pushDir.lengthSq() < 0.0001) pushDir.set(0, 0, 1);
      pushDir.normalize();
      pos.add(pushDir.multiplyScalar(rad - dist + 0.01));
      hitAny = true;
    }
  }
  return hitAny;
}

/* =========================
   CAMERAS
========================= */
const topCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
const fpsCamera = new THREE.PerspectiveCamera(CONFIG.fpsFov, window.innerWidth / window.innerHeight, 0.1, 100);

let activeCamera = topCamera;
let isFPS = false;

let yaw = 0, pitch = 0;
let lookActive = false;

const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();

function computeMoveBasis(cam) {
  cam.getWorldDirection(camForward);
  camForward.y = 0;
  if (camForward.lengthSq() < 0.0001) camForward.set(0, 0, -1);
  camForward.normalize();
  camRight.crossVectors(new THREE.Vector3(0, 1, 0), camForward).normalize();
}

/* =========================
   CAMERA SHAKE (NEW)
========================= */
let shakeIntensity = 0;
let shakeTime = 0;

function addCameraShake(intensity = 0.3, duration = 0.3) {
  if (!CONFIG.cameraShake) return;
  shakeIntensity = Math.max(shakeIntensity, intensity);
  shakeTime = duration;
}

function updateCameraShake(dt) {
  if (shakeTime > 0) {
    shakeTime -= dt;
    const shake = shakeIntensity * (shakeTime / 0.3);
    activeCamera.position.x += (Math.random() - 0.5) * shake * 0.1;
    activeCamera.position.y += (Math.random() - 0.5) * shake * 0.1;
  }
}

/* =========================
   FPS CAMERA + MOUSE
========================= */
function updateFpsCamera() {
  const speed01 = clamp(lastMoveSpeed / CONFIG.moveMaxSpeed, 0, 1);
  // Cheap head bob (no fog/post)
  const bobFreq = 8.5;
  const bobAmp = 0.06;
  const bob = Math.sin(performance.now() * 0.001 * bobFreq) * bobAmp * speed01;

  const offset = new THREE.Vector3(
    Math.sin(yaw) * 0.01,
    CONFIG.fpsEyeHeight + bob,
    Math.cos(yaw) * 0.01
  );
  fpsCamera.position.copy(player.position).add(offset);

  const lookDir = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  );
  fpsCamera.lookAt(fpsCamera.position.clone().add(lookDir));
}

renderer.domElement.addEventListener("click", () => {
  if (!isFPS) return;
  renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  lookActive = (document.pointerLockElement === renderer.domElement);
});

renderer.domElement.addEventListener("mousemove", (e) => {
  if (!lookActive || !isFPS) return;

  const sensitivity = 0.002;
  yaw -= e.movementX * sensitivity;
  pitch -= e.movementY * sensitivity;
  pitch = clamp(pitch, -CONFIG.fpsPitchLimit, CONFIG.fpsPitchLimit);
});

// MOBILE TOUCH LOOK CONTROLS
let touchStartX = 0;
let touchStartY = 0;
let touchLookActive = false;

renderer.domElement.addEventListener("touchstart", (e) => {
  if (!isFPS) return;
  if (e.touches.length === 1) {
    touchLookActive = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

renderer.domElement.addEventListener("touchmove", (e) => {
  if (!isFPS || !touchLookActive) return;
  if (e.touches.length === 1) {
    const sensitivity = 0.003;
    const deltaX = e.touches[0].clientX - touchStartX;
    const deltaY = e.touches[0].clientY - touchStartY;
    
    yaw -= deltaX * sensitivity;
    pitch -= deltaY * sensitivity;
    pitch = clamp(pitch, -CONFIG.fpsPitchLimit, CONFIG.fpsPitchLimit);
    
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

renderer.domElement.addEventListener("touchend", () => {
  touchLookActive = false;
});

renderer.domElement.addEventListener("touchcancel", () => {
  touchLookActive = false;
});

/* =========================
   TOP CAMERA
========================= */
function setStaticTopCamera() {
  topCamera.position.set(WORLD_CENTER.x, CONFIG.topCamHeight, WORLD_CENTER.z);
  topCamera.lookAt(WORLD_CENTER.x, 0, WORLD_CENTER.z);
  topCamera.up.set(0, 0, -1);
}

function fitTopOrthoCamera() {
  const halfMazeW = worldW * 0.5 * CONFIG.orthoPadding;
  const halfMazeD = worldD * 0.5 * CONFIG.orthoPadding;

  const aspect = window.innerWidth / window.innerHeight;
  const mazeAspect = worldW / worldD;

  let halfW, halfH;
  if (aspect >= mazeAspect) {
    halfH = halfMazeD;
    halfW = halfH * aspect;
  } else {
    halfW = halfMazeW;
    halfH = halfW / aspect;
  }

  topCamera.left = -halfW;
  topCamera.right = halfW;
  topCamera.top = halfH;
  topCamera.bottom = -halfH;
  topCamera.updateProjectionMatrix();
}

function setHudMode() {
  if (ui.mode) ui.mode.textContent = isFPS ? "Mode: First Person" : "Mode: Top-Down";
  if (ui.crosshair) ui.crosshair.classList.toggle("hidden", !isFPS);
  if (ui.hint) ui.hint.style.display = "none";
}

function toggleCameraMode() {
  AudioFX.click();
  isFPS = !isFPS;
  activeCamera = isFPS ? fpsCamera : topCamera;

  // Skybox only in FPS mode
  scene.background = isFPS ? SKY_TEX : TOP_BG_COLOR;

  if (isFPS) {
    yaw = player.rotation.y;
    pitch = 0;
    updateFpsCamera();
  } else {
    lookActive = false;
  }

  setHudMode();
}
ui.btnCam?.addEventListener("click", toggleCameraMode);

/* =========================
   LEVEL BUILD
========================= */
function disposeLevelObjects() {
  if (ground) {
    scene.remove(ground);
    ground.geometry.dispose();
    ground = null;
  }
  if (wallsInst) {
    scene.remove(wallsInst);
    wallsInst = null;
  }
  if (wallTopsInst) {
    scene.remove(wallTopsInst);
    wallTopsInst = null;
  }
  if (goal) {
    scene.remove(goal);
    goal.material.dispose();
    goal = null;
  }
  wallBoxes = [];
  trailPoints.length = 0;
}

let hasWon = false;
let levelTransitioning = false;

function rebuildLevel(level) {
  disposeLevelObjects();

  const lvl = generateMaze(level);
  MAZE = lvl.grid;
  mazeRows = lvl.rows;
  mazeCols = lvl.cols;

  worldW = mazeCols * CONFIG.cellSize;
  worldD = mazeRows * CONFIG.cellSize;

  WORLD_CENTER.set(
    worldW * 0.5 - CONFIG.cellSize * 0.5,
    0,
    worldD * 0.5 - CONFIG.cellSize * 0.5
  );

  const gridToWorldLocal = (r, c) => new THREE.Vector3(c * CONFIG.cellSize, 0, r * CONFIG.cellSize);

  startPos = gridToWorldLocal(lvl.start.r, lvl.start.c);
  goalPos = gridToWorldLocal(lvl.goal.r, lvl.goal.c);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(worldW, worldD);
  groundGeo.setAttribute("uv2", new THREE.BufferAttribute(groundGeo.attributes.uv.array, 2));
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.set(WORLD_CENTER.x, 0, WORLD_CENTER.z);
  ground.receiveShadow = true;
  scene.add(ground);

  // Walls instanced
  let count = 0;
  for (let r = 0; r < mazeRows; r++) for (let c = 0; c < mazeCols; c++) if (MAZE[r][c] === 1) count++;

  wallsInst = new THREE.InstancedMesh(wallGeo, wallMat, count);
  wallsInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  wallsInst.castShadow = true;
  wallsInst.receiveShadow = true;
  scene.add(wallsInst);

  // Wall tops for edge highlighting
  wallTopsInst = new THREE.InstancedMesh(wallTopGeo, wallTopMat, count);
  wallTopsInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  wallTopsInst.castShadow = false;
  wallTopsInst.receiveShadow = false;
  scene.add(wallTopsInst);

  const m = new THREE.Matrix4();
  const mTop = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const posTop = new THREE.Vector3();
  const half = new THREE.Vector3(CONFIG.wallSize * 0.5, CONFIG.wallHeight * 0.5, CONFIG.wallSize * 0.5);

  let idx = 0;
  for (let r = 0; r < mazeRows; r++) {
    for (let c = 0; c < mazeCols; c++) {
      if (MAZE[r][c] !== 1) continue;

      const p = gridToWorldLocal(r, c);
      pos.set(p.x, CONFIG.wallHeight * 0.5, p.z);
      // Place the top cap slightly ABOVE the wall to avoid z-fighting flicker
      posTop.set(p.x, CONFIG.wallHeight + 0.04 + 0.002, p.z);

      m.makeTranslation(pos.x, pos.y, pos.z);
      wallsInst.setMatrixAt(idx, m);

      mTop.makeTranslation(posTop.x, posTop.y, posTop.z);
      wallTopsInst.setMatrixAt(idx, mTop);

      wallBoxes.push(
        new THREE.Box3(
          new THREE.Vector3(pos.x - half.x, pos.y - half.y, pos.z - half.z),
          new THREE.Vector3(pos.x + half.x, pos.y + half.y, pos.z + half.z)
        )
      );

      idx++;
    }
  }
  wallsInst.instanceMatrix.needsUpdate = true;
  wallTopsInst.instanceMatrix.needsUpdate = true;

  // Goal (enhanced)
  const goalMat = new THREE.MeshStandardMaterial({
    color: 0xfde047,
    emissive: 0xfbbf24,
    emissiveIntensity: 1.6,
    roughness: 0.2,
    metalness: 0.3,
  });
  goal = new THREE.Mesh(goalGeo, goalMat);
  goal.position.set(goalPos.x, 0.55, goalPos.z);
  goal.castShadow = true;
  scene.add(goal);

  // Goal glow
  const goalGlow = new THREE.PointLight(0xfde047, 2.8, 8);
  goalGlow.position.set(goalPos.x, 1.2, goalPos.z);
  scene.add(goalGlow);

  // Reset player
  player.position.set(startPos.x, CONFIG.playerY, startPos.z);
  playerVel.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  yaw = 0;
  pitch = 0;

  // Cameras
  setStaticTopCamera();
  fitTopOrthoCamera();
  if (isFPS) updateFpsCamera();

  // UI
  hasWon = false;
  hideWin();
  if (ui.status) ui.status.textContent = "Reach the goal! (Press C to toggle camera)";
  LevelManager.updateUI?.();
  setHudMode();
}

/* =========================
   GAME API
========================= */
const Game = {
  loadLevel(level) { rebuildLevel(level); }
};

// init
Game.loadLevel(LevelManager.getLevel());

/* =========================
   WIN FLOW
========================= */
function showWin() {
  hasWon = true;
  ui.winOverlay?.classList.remove("hidden");
  if (ui.status) ui.status.textContent = "Win!";
  AudioFX.win();
  if (goal) spawnWinBurst(goal.position);
  addCameraShake(0.5, 0.5);
}

function hideWin() {
  ui.winOverlay?.classList.add("hidden");
}

ui.restartBtn?.addEventListener("click", () => {
  AudioFX.click();
  hideWin();
  LevelManager.restart();
  Game.loadLevel(LevelManager.getLevel());
});

ui.nextBtn?.addEventListener("click", () => {
  AudioFX.click();
  hideWin();
  LevelManager.nextLevel();
  Game.loadLevel(LevelManager.getLevel());
});

/* =========================
   MOVE (smooth) + SFX + FX
========================= */
function movePlayer(dt, t) {
  let f = 0, s = 0;
  if (input.up) f += 1;
  if (input.down) f -= 1;
  if (input.left) s += 1;
  if (input.right) s -= 1;

  const len = Math.hypot(f, s);
  computeMoveBasis(activeCamera);

  const desired = new THREE.Vector3(0, 0, 0);
  if (len > 0) {
    f /= len; s /= len;
    desired.x = (camForward.x * f + camRight.x * s) * CONFIG.moveMaxSpeed;
    desired.z = (camForward.z * f + camRight.z * s) * CONFIG.moveMaxSpeed;
  }

  if (len > 0) {
    const turnBoost = CONFIG.moveTurnBoost * dt;
    playerVel.x += (desired.x - playerVel.x) * clamp((CONFIG.moveAccel * dt) + turnBoost, 0, 1);
    playerVel.z += (desired.z - playerVel.z) * clamp((CONFIG.moveAccel * dt) + turnBoost, 0, 1);
    AudioFX.startSteps();
  } else {
    playerVel.x += (0 - playerVel.x) * clamp(CONFIG.moveDecel * dt, 0, 1);
    playerVel.z += (0 - playerVel.z) * clamp(CONFIG.moveDecel * dt, 0, 1);
    if (Math.abs(playerVel.x) < 0.01 && Math.abs(playerVel.z) < 0.01) AudioFX.stopSteps();
  }

  const sp = Math.hypot(playerVel.x, playerVel.z);
  if (sp > CONFIG.moveMaxSpeed) {
    const k = CONFIG.moveMaxSpeed / sp;
    playerVel.x *= k;
    playerVel.z *= k;
  }

  const next = new THREE.Vector3(
    player.position.x + playerVel.x * dt,
    CONFIG.playerY,
    player.position.z + playerVel.z * dt
  );

  const hitWall = resolveSphereAABBCollisions(next, CONFIG.playerRadius);
  if (hitWall) {
    AudioFX.bump();
    playerVel.x *= 0.35;
    playerVel.z *= 0.35;
    addCameraShake(0.15, 0.15);
  }

  player.position.copy(next);

  const speed = Math.hypot(playerVel.x, playerVel.z);
  lastMoveSpeed = speed;
  if (speed > 0.05) {
    player.rotation.y = Math.atan2(playerVel.x, -playerVel.z);

    const dist = speed * dt;
    const roll = dist / CONFIG.playerRadius;
    player.rotateX(roll);

    // Add trail particles
    if (CONFIG.trailEffect && Math.random() < 0.3) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.3
      );
      particleSystem.addParticle(
        player.position.clone().add(offset),
        new THREE.Vector3(0, 0.5, 0),
        0.5
      );
    }
  }

  // Update player glow
  const speed01 = clamp(speed / CONFIG.moveMaxSpeed, 0, 1);
  playerGlow.intensity = 1.2 + speed01 * 1.0;

  updateTrail();

  return speed > 0.05;
}

/* =========================
   LOOP
========================= */
let lastT = performance.now();

function loop(nowMs) {
  requestAnimationFrame(loop);

  const dt = Math.min(0.05, (nowMs - lastT) / 1000);
  lastT = nowMs;
  const t = nowMs / 1000;

  if (!hasWon) {
    movePlayer(dt, t);

    if (goal && player.position.distanceTo(goal.position) <= CONFIG.winDistance) {
      showWin();
    }
  } else {
    AudioFX.stopSteps();
  }

  AudioFX.update(dt);
  updateBursts(dt);
  particleSystem.update(dt);
  updateCameraShake(dt);

  if (goal) {
    goal.rotation.y += dt * 1.5;
    // Pulsing effect
    const pulse = 1.0 + Math.sin(t * 3) * 0.05;
    goal.scale.set(pulse, pulse, pulse);
  }

  if (isFPS) updateFpsCamera();

  renderer.render(scene, activeCamera);
}

requestAnimationFrame(loop);

/* =========================
   RESIZE
========================= */
function onResize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);

  setStaticTopCamera();
  fitTopOrthoCamera();

  fpsCamera.aspect = window.innerWidth / window.innerHeight;
  fpsCamera.updateProjectionMatrix();
}
window.addEventListener("resize", onResize);
onResize();