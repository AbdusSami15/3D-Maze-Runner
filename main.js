import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const CONFIG = {
  cellSize: 2,
  wallHeight: 1.6,
  wallSize: 2,

  playerRadius: 0.45,
  playerY: 0.45,
  moveSpeed: 3.2,

  // Top cam (KEEP AS-IS)
  topCamHeight: 40,
  orthoPadding: 1.12,

  // FPS
  fpsEyeHeight: 0.75,
  fpsFov: 70,
  fpsPitchLimit: 1.15,

  winDistance: 0.9,
  maxPixelRatio: 2,

  textures: {
    ground: "./assets/ground.jpg",
    wall: "./assets/wall.jpg",
  },
};

// 1 = wall, 0 = path
const MAZE = [
  [1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,1,0,1,0,1,1,1,1,0,1],
  [1,0,1,0,0,0,0,0,0,1,0,1],
  [1,0,1,1,1,1,0,1,0,1,0,1],
  [1,0,0,0,0,1,0,1,0,0,0,1],
  [1,1,1,1,0,1,0,1,1,1,0,1],
  [1,0,0,1,0,0,0,0,0,1,0,1],
  [1,0,1,1,1,1,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,1,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1],
];

const START = { r: 1, c: 1 };
const GOAL  = { r: 9, c: 10 };

const mazeRows = MAZE.length;
const mazeCols = MAZE[0].length;

const worldW = mazeCols * CONFIG.cellSize;
const worldD = mazeRows * CONFIG.cellSize;

const WORLD_CENTER = new THREE.Vector3(
  worldW * 0.5 - CONFIG.cellSize * 0.5,
  0,
  worldD * 0.5 - CONFIG.cellSize * 0.5
);

const gridToWorld = (r, c) => new THREE.Vector3(c * CONFIG.cellSize, 0, r * CONFIG.cellSize);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ---------- DOM ----------
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
};

ui.restartBtn?.addEventListener("click", restart);

// ---------- INPUT ----------
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

// ---------- THREE ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Cameras
const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const fpsCamera = new THREE.PerspectiveCamera(
  CONFIG.fpsFov,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);

let activeCamera = topCamera;
let isFPS = false;

// FPS look (NO CURSOR LOCK)
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

// Textures
const texLoader = new THREE.TextureLoader();
function setupRepeat(tex, rx, ry) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);
  tex.colorSpace = THREE.SRGBColorSpace;
}
function tryLoadTexture(url, onOk) {
  texLoader.load(url, onOk, undefined, () => {});
}

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(8, 14, 6);
scene.add(dir);

// Ground
const groundGeo = new THREE.PlaneGeometry(worldW, worldD);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x101826, roughness: 0.95, metalness: 0.0 });
tryLoadTexture(CONFIG.textures.ground, (tex) => {
  setupRepeat(tex, Math.max(1, worldW / 6), Math.max(1, worldD / 6));
  groundMat.map = tex;
  groundMat.needsUpdate = true;
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI * 0.5;
ground.position.set(WORLD_CENTER.x, 0, WORLD_CENTER.z);
scene.add(ground);

// Walls (InstancedMesh)
const wallGeo = new THREE.BoxGeometry(CONFIG.wallSize, CONFIG.wallHeight, CONFIG.wallSize);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3347, roughness: 0.9, metalness: 0.0 });
tryLoadTexture(CONFIG.textures.wall, (tex) => {
  setupRepeat(tex, 1, 1);
  wallMat.map = tex;
  wallMat.needsUpdate = true;
});

let wallCount = 0;
for (let r = 0; r < mazeRows; r++) for (let c = 0; c < mazeCols; c++) if (MAZE[r][c] === 1) wallCount++;

const wallsInst = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
wallsInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
scene.add(wallsInst);

// Collision AABBs
const wallBoxes = [];
{
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const half = new THREE.Vector3(CONFIG.wallSize * 0.5, CONFIG.wallHeight * 0.5, CONFIG.wallSize * 0.5);

  let idx = 0;
  for (let r = 0; r < mazeRows; r++) {
    for (let c = 0; c < mazeCols; c++) {
      if (MAZE[r][c] !== 1) continue;

      const p = gridToWorld(r, c);
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
}

// Player
const playerGeo = new THREE.SphereGeometry(CONFIG.playerRadius, 18, 14);
const playerMat = new THREE.MeshStandardMaterial({ color: 0x7bd7ff, roughness: 0.35, metalness: 0.0 });
const player = new THREE.Mesh(playerGeo, playerMat);

const startPos = gridToWorld(START.r, START.c);
player.position.set(startPos.x, CONFIG.playerY, startPos.z);
scene.add(player);

// Goal
const goalGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
const goalMat = new THREE.MeshStandardMaterial({
  color: 0xffd36a,
  emissive: 0xff9b2f,
  emissiveIntensity: 1.1,
  roughness: 0.3,
  metalness: 0.0,
});
const goal = new THREE.Mesh(goalGeo, goalMat);
const goalPos = gridToWorld(GOAL.r, GOAL.c);
goal.position.set(goalPos.x, 0.55, goalPos.z);
scene.add(goal);

// ---------- TOP CAMERA (UNCHANGED) ----------
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

setStaticTopCamera();
fitTopOrthoCamera();

// ---------- FPS CAMERA ----------
function updateFpsCamera() {
  fpsCamera.position.set(
    player.position.x,
    CONFIG.playerY + CONFIG.fpsEyeHeight,
    player.position.z
  );
  fpsCamera.rotation.order = "YXZ";
  fpsCamera.rotation.y = yaw;
  fpsCamera.rotation.x = pitch;
}

// ---------- CAMERA TOGGLE ----------
function setHudMode() {
  if (ui.mode) ui.mode.textContent = isFPS ? "Mode: First Person" : "Mode: Top-Down";
  if (ui.hint) ui.hint.style.display = "none";
  if (ui.crosshair) ui.crosshair.classList.toggle("hidden", !isFPS);
}

function toggleCameraMode() {
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

// ---------- COLLISION ----------
const tmpClosest = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();

function resolveSphereAABBCollisions(center, radius) {
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
}

// ---------- MOVEMENT (ONE RULE FOR BOTH MODES) ----------
// Up = move along activeCamera forward (XZ), Down = backward, Left/Right = strafe.
const camDir = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

function computeMoveBasis(cam) {
  cam.getWorldDirection(camDir);

  // forward on XZ
  camForward.set(camDir.x, 0, camDir.z);
  if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, -1);
  camForward.normalize();

  // right = forward x up (XZ)
  camRight.crossVectors(camForward, worldUp);
  if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0);
  camRight.normalize();
}

function movePlayer(dt) {
  // input -> desired local move (always same meaning)
  let f = 0; // forward
  let s = 0; // strafe right

  if (input.up) f += 1;
  if (input.down) f -= 1;
  if (input.right) s += 1;
  if (input.left) s -= 1;

  const len = Math.hypot(f, s);
  if (len > 0) { f /= len; s /= len; }

  // basis from CURRENT active camera
  // - topCamera: fixed anyway
  // - fpsCamera: yaw changes direction
  computeMoveBasis(activeCamera);

  const step = CONFIG.moveSpeed * dt;

  const dx = (camForward.x * f + camRight.x * s) * step;
  const dz = (camForward.z * f + camRight.z * s) * step;

  const next = new THREE.Vector3(
    player.position.x + dx,
    CONFIG.playerY,
    player.position.z + dz
  );

  resolveSphereAABBCollisions(next, CONFIG.playerRadius);
  player.position.copy(next);

  // rotate player to movement direction (if moving)
  if (len > 0) {
    player.rotation.y = Math.atan2(dx, -dz);
  }
}

// ---------- UI ----------
let hasWon = false;

function showWin() {
  hasWon = true;
  ui.winOverlay?.classList.remove("hidden");
  if (ui.status) ui.status.textContent = "Win!";
}

function restart() {
  hasWon = false;
  ui.winOverlay?.classList.add("hidden");
  player.position.set(startPos.x, CONFIG.playerY, startPos.z);
  if (ui.status) ui.status.textContent = "Reach the goal!";
  if (isFPS) {
    yaw = player.rotation.y;
    pitch = 0;
    updateFpsCamera();
  }
}

// ---------- LOOP ----------
let lastT = performance.now();

function loop(t) {
  requestAnimationFrame(loop);

  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (!hasWon) {
    movePlayer(dt);

    if (player.position.distanceTo(goal.position) <= CONFIG.winDistance) {
      showWin();
    }
  }

  goal.rotation.y += dt * 1.3;

  if (isFPS) updateFpsCamera();

  renderer.render(scene, activeCamera);
}

requestAnimationFrame(loop);

// ---------- RESIZE ----------
function onResize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // keep top framing
  setStaticTopCamera();
  fitTopOrthoCamera();

  fpsCamera.aspect = window.innerWidth / window.innerHeight;
  fpsCamera.updateProjectionMatrix();
}

window.addEventListener("resize", onResize);
onResize();
