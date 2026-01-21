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

  // Movement feel (FASTER)
  moveMaxSpeed: 7.0,   // was 4.0
  moveAccel: 30.0,     // was 18.0
  moveDecel: 26.0,     // was 22.0
  moveTurnBoost: 12.0, // was 10.0

  // Top cam
  topCamHeight: 40,
  orthoPadding: 1.12,

  // FPS
  fpsEyeHeight: 0.75,
  fpsFov: 70,
  fpsPitchLimit: 1.15,

  winDistance: 0.9,
  maxPixelRatio: 2,

  // Levels
  startLevel: 1,
  maxLevel: 50,
  baseMazeOddSize: 11,
  sizeGrowEveryLevel: 2,
  loopChanceBase: 0.04,
  loopChanceGrow: 0.01,

  // Audio
  audioEnabled: true,
  stepIntervalMs: 220,
  bumpCooldownMs: 120,
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function makeOdd(n) { return (n % 2 === 0) ? n + 1 : n; }

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
   AUDIO (no external files)
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
    master.gain.value = 0.22;
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

  function click() { tone(520, 50, "square", 0.22); }
  function win() {
    tone(392, 90, "sine", 0.22);
    setTimeout(() => tone(523, 120, "sine", 0.26), 90);
    setTimeout(() => tone(659, 140, "sine", 0.28), 220);
  }

  function bump() {
    const now = performance.now();
    if (now - lastBumpAt < CONFIG.bumpCooldownMs) return;
    lastBumpAt = now;
    tone(130, 55, "sawtooth", 0.20);
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
      tone(220 + Math.random() * 30, 30, "triangle", 0.10);
    }
  }

  return { userGestureUnlock, click, win, bump, startSteps, stopSteps, update };
})();

window.addEventListener("pointerdown", () => AudioFX.userGestureUnlock(), { once: true });
window.addEventListener("keydown", () => AudioFX.userGestureUnlock(), { once: true });

/* =========================
   LEVEL SYSTEM + GENERATOR
   (UNCHANGED)
========================= */
function generateMaze(level) {
  const size = makeOdd(CONFIG.baseMazeOddSize + (level - 1) * CONFIG.sizeGrowEveryLevel);
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
  const KEY = "maze3d_progress_v1";
  let currentLevel = CONFIG.startLevel;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data?.level === "number") currentLevel = clamp(data.level, 1, CONFIG.maxLevel);
    } catch {}
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ level: currentLevel })); } catch {}
  }

  function setLevel(lvl) {
    currentLevel = clamp(lvl, 1, CONFIG.maxLevel);
    save();
    Game.loadLevel(currentLevel);
  }

  function nextLevel() { setLevel(currentLevel + 1); }
  function restartLevel() { setLevel(currentLevel); }
  function getLevel() { return currentLevel; }

  load();
  return { setLevel, nextLevel, restartLevel, getLevel };
})();

ui.restartBtn?.addEventListener("click", () => LevelManager.restartLevel());
ui.nextBtn?.addEventListener("click", () => LevelManager.nextLevel());

/* =========================
   THREE SCENE (BRIGHT, NO FOG)
========================= */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16233a);
scene.fog = null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.2;

document.body.appendChild(renderer.domElement);

// Strong readable lights
scene.add(new THREE.AmbientLight(0xffffff, 1.15));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.position.set(10, 18, 10);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
fillLight.position.set(-10, 10, -8);
scene.add(fillLight);

const hemi = new THREE.HemisphereLight(0xffffff, 0x4a6aa6, 1.0);
scene.add(hemi);

/* =========================
   SKY DOME (BRIGHTER)
========================= */
(function createSkyDome() {
  const skyGeo = new THREE.SphereGeometry(260, 24, 16);
  skyGeo.scale(-1, 1, 1);

  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#263a63");
  grad.addColorStop(0.55, "#16233a");
  grad.addColorStop(1.0, "#0b1020");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const skyMat = new THREE.MeshBasicMaterial({ map: tex });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
})();

// Cameras
const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
const fpsCamera = new THREE.PerspectiveCamera(CONFIG.fpsFov, window.innerWidth / window.innerHeight, 0.1, 800);

let activeCamera = topCamera;
let isFPS = false;

// IMPORTANT: FIX for your console error
let hasWon = false; // must exist before loadLevel()

/* =========================
   FPS LOOK (NO POINTER LOCK)
========================= */
let yaw = 0;
let pitch = 0;
let lookActive = false;
let lastX = 0;
let lastY = 0;

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (!isFPS) return;
  lookActive = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

function stopLook() { lookActive = false; }
renderer.domElement.addEventListener("pointerup", stopLook);
renderer.domElement.addEventListener("pointerleave", stopLook);
renderer.domElement.addEventListener("pointercancel", stopLook);

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!isFPS || !lookActive) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  yaw -= dx * 0.004;
  pitch -= dy * 0.004;
  pitch = clamp(pitch, -CONFIG.fpsPitchLimit, CONFIG.fpsPitchLimit);
});

/* =========================
   PROCEDURAL TEXTURES (BRIGHTER)
========================= */
function makeGroundTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#253a63";
  g.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 2200; i++) {
    const x = (Math.random() * 256) | 0;
    const y = (Math.random() * 256) | 0;
    const a = Math.random() * 0.09;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWallTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#4a5f8f";
  g.fillRect(0, 0, 256, 256);

  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.lineWidth = 2;
  for (let y = 0; y <= 256; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  for (let x = 0; x <= 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }

  for (let i = 0; i < 1400; i++) {
    const x = (Math.random() * 256) | 0;
    const y = (Math.random() * 256) | 0;
    const a = Math.random() * 0.04;
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const groundMat = new THREE.MeshStandardMaterial({
  map: makeGroundTexture(),
  roughness: 0.98,
  metalness: 0.0,
  color: 0xffffff,
  emissive: 0x0b1630,
  emissiveIntensity: 0.35,
});

const wallMat = new THREE.MeshStandardMaterial({
  map: makeWallTexture(),
  roughness: 0.85,
  metalness: 0.0,
  color: 0xf3f7ff,
  emissive: 0x1a2f55,
  emissiveIntensity: 0.55,
});

/* =========================
   PLAYER (SMOOTH MOVE + FX) - NO TRAIL
========================= */
const playerVel = new THREE.Vector3(0, 0, 0);

const playerGeo = new THREE.SphereGeometry(CONFIG.playerRadius, 24, 18);
const playerMat = new THREE.MeshStandardMaterial({
  color: 0x6fe1ff,
  roughness: 0.22,
  metalness: 0.05,
  emissive: 0x062033,
  emissiveIntensity: 0.65,
});
const player = new THREE.Mesh(playerGeo, playerMat);
scene.add(player);

function createGlowSprite() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");

  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0.0, "rgba(120,255,255,0.70)");
  grd.addColorStop(0.35, "rgba(120,255,255,0.26)");
  grd.addColorStop(1.0, "rgba(120,255,255,0.0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(2.4, 2.4, 1);
  return spr;
}

const ballGlow = createGlowSprite();
player.add(ballGlow);
ballGlow.position.set(0, 0.15, 0);

function updateBallFX(t, speed01) {
  playerMat.emissiveIntensity = 0.45 + speed01 * 1.0 + Math.sin(t * 6.0) * 0.05;
  const s = 2.0 + speed01 * 1.2;
  ballGlow.scale.set(s, s, 1);
}

/* =========================
   LEVEL OBJECTS
========================= */
let ground = null;
let wallsInst = null;
let goal = null;

let wallBoxes = [];
let MAZE = null;
let mazeRows = 0;
let mazeCols = 0;
let worldW = 0;
let worldD = 0;
let WORLD_CENTER = new THREE.Vector3(0, 0, 0);
let startPos = new THREE.Vector3(0, 0, 0);
let goalPos = new THREE.Vector3(0, 0, 0);

const wallGeo = new THREE.BoxGeometry(CONFIG.wallSize, CONFIG.wallHeight, CONFIG.wallSize);
const goalGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);

/* =========================
   EFFECTS (win burst)
========================= */
const activeBursts = [];
function spawnWinBurst(pos) {
  const count = 90;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    positions[i3 + 0] = pos.x;
    positions[i3 + 1] = pos.y + 0.6;
    positions[i3 + 2] = pos.z;

    const a = Math.random() * Math.PI * 2;
    const s = 1.2 + Math.random() * 2.0;
    velocities[i3 + 0] = Math.cos(a) * s;
    velocities[i3 + 1] = 2.2 + Math.random() * 2.0;
    velocities[i3 + 2] = Math.sin(a) * s;
  }

  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ size: 0.12 });
  const points = new THREE.Points(geom, mat);
  scene.add(points);

  activeBursts.push({ points, positions, velocities, life: 0.9 });
}

function updateBursts(dt) {
  for (let i = activeBursts.length - 1; i >= 0; i--) {
    const b = activeBursts[i];
    b.life -= dt;
    const p = b.positions;
    const v = b.velocities;

    for (let j = 0; j < p.length; j += 3) {
      v[j + 1] -= 9.8 * dt;
      p[j + 0] += v[j + 0] * dt;
      p[j + 1] += v[j + 1] * dt;
      p[j + 2] += v[j + 2] * dt;
    }

    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.material.opacity = clamp(b.life / 0.9, 0, 1);
    b.points.material.transparent = true;

    if (b.life <= 0) {
      scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
      activeBursts.splice(i, 1);
    }
  }
}

/* =========================
   COLLISION
========================= */
const tmpClosest = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();

function resolveSphereAABBCollisions(center, radius) {
  let hit = false;

  for (let i = 0; i < wallBoxes.length; i++) {
    const b = wallBoxes[i];

    tmpClosest.set(
      clamp(center.x, b.min.x, b.max.x),
      clamp(center.y, b.min.y, b.max.y),
      clamp(center.z, b.min.z, b.max.z)
    );

    tmpDelta.subVectors(center, tmpClosest);
    const distSq = tmpDelta.lengthSq();
    const rSq = radius * radius;

    if (distSq < rSq) {
      hit = true;

      let dist = Math.sqrt(distSq);
      if (dist < 1e-6) {
        const dxMin = Math.abs(center.x - b.min.x);
        const dxMax = Math.abs(b.max.x - center.x);
        const dzMin = Math.abs(center.z - b.min.z);
        const dzMax = Math.abs(b.max.z - center.z);

        const minPen = Math.min(dxMin, dxMax, dzMin, dzMax);

        if (minPen === dxMin) center.x = b.min.x - radius;
        else if (minPen === dxMax) center.x = b.max.x + radius;
        else if (minPen === dzMin) center.z = b.min.z - radius;
        else center.z = b.max.z + radius;

        continue;
      }

      const push = (radius - dist);
      tmpDelta.multiplyScalar(1 / dist);
      center.addScaledVector(tmpDelta, push);
    }
  }

  return hit;
}

/* =========================
   MOVEMENT (camera-relative)
========================= */
const camDir = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

function computeMoveBasis(cam) {
  cam.getWorldDirection(camDir);

  camForward.set(camDir.x, 0, camDir.z);
  if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, -1);
  camForward.normalize();

  camRight.crossVectors(camForward, worldUp);
  if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0);
  camRight.normalize();
}

function updateFpsCamera() {
  fpsCamera.position.set(player.position.x, CONFIG.playerY + CONFIG.fpsEyeHeight, player.position.z);
  fpsCamera.rotation.order = "YXZ";
  fpsCamera.rotation.y = yaw;
  fpsCamera.rotation.x = pitch;
}

function setStaticTopCamera() {
  topCamera.position.set(WORLD_CENTER.x, CONFIG.topCamHeight, WORLD_CENTER.z);
  topCamera.up.set(0, 0, -1);
  topCamera.lookAt(WORLD_CENTER.x, 0, WORLD_CENTER.z);
}

function fitTopOrthoCamera() {
  const aspect = window.innerWidth / window.innerHeight;

  const halfMazeW = (worldW * 0.5) * CONFIG.orthoPadding;
  const halfMazeD = (worldD * 0.5) * CONFIG.orthoPadding;

  const mazeAspect = halfMazeW / halfMazeD;

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
  if (goal) {
    scene.remove(goal);
    goal.material.dispose();
    goal = null;
  }
  wallBoxes = [];
}

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
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.set(WORLD_CENTER.x, 0, WORLD_CENTER.z);
  groundMat.map.repeat.set(Math.max(1, worldW / 6), Math.max(1, worldD / 6));
  scene.add(ground);

  // Walls instanced
  let count = 0;
  for (let r = 0; r < mazeRows; r++) for (let c = 0; c < mazeCols; c++) if (MAZE[r][c] === 1) count++;

  wallsInst = new THREE.InstancedMesh(wallGeo, wallMat, count);
  wallsInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  scene.add(wallsInst);

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const half = new THREE.Vector3(CONFIG.wallSize * 0.5, CONFIG.wallHeight * 0.5, CONFIG.wallSize * 0.5);

  let idx = 0;
  for (let r = 0; r < mazeRows; r++) {
    for (let c = 0; c < mazeCols; c++) {
      if (MAZE[r][c] !== 1) continue;

      const p = gridToWorldLocal(r, c);
      pos.set(p.x, CONFIG.wallHeight * 0.5, p.z);

      m.makeTranslation(pos.x, pos.y, pos.z);
      wallsInst.setMatrixAt(idx, m);

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

  // Goal
  const goalMat = new THREE.MeshStandardMaterial({
    color: 0xffd36a,
    emissive: 0xff9b2f,
    emissiveIntensity: 1.1,
    roughness: 0.35,
    metalness: 0.0,
  });
  goal = new THREE.Mesh(goalGeo, goalMat);
  goal.position.set(goalPos.x, 0.55, goalPos.z);
  scene.add(goal);

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
  if (ui.levelText) ui.levelText.textContent = `Level ${level}`;
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
}

function hideWin() {
  ui.winOverlay?.classList.add("hidden");
}

/* =========================
   MOVE (smooth) + SFX
========================= */
function movePlayer(dt, t) {
  let f = 0, s = 0;
  if (input.up) f += 1;
  if (input.down) f -= 1;
  if (input.right) s += 1;
  if (input.left) s -= 1;

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
  }

  player.position.copy(next);

  const speed = Math.hypot(playerVel.x, playerVel.z);
  if (speed > 0.05) {
    player.rotation.y = Math.atan2(playerVel.x, -playerVel.z);

    const dist = speed * dt;
    const roll = dist / CONFIG.playerRadius;
    player.rotateX(roll);
  }

  const speed01 = clamp(speed / CONFIG.moveMaxSpeed, 0, 1);
  updateBallFX(t, speed01);

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
      setTimeout(() => LevelManager.nextLevel(), 650);
    }
  } else {
    AudioFX.stopSteps();
  }

  AudioFX.update(dt);
  updateBursts(dt);

  if (goal) goal.rotation.y += dt * 1.3;
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
