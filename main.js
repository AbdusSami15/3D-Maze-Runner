import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const CONFIG = {
  cellSize: 2,
  wallHeight: 1.6,
  wallSize: 2,

  playerRadius: 0.45,
  playerY: 0.45,

  moveSpeed: 3.2,

  topDownHeight: 14,
  topDownLerp: 0.12,

  fpsEyeHeight: 1.0,
  fpsLerp: 0.18,
  mouseSensitivity: 0.0022,
  maxPitch: Math.PI * 0.48,

  winDistance: 0.9,

  maxPixelRatio: 2,

  minimapSize: 220,
  minimapPadding: 14,
  minimapWorldMargin: 2,
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

function gridToWorld(r, c) {
  return new THREE.Vector3(c * CONFIG.cellSize, 0, r * CONFIG.cellSize);
}

// ---------- DOM ----------
const statusEl = document.getElementById("status");
const modeEl = document.getElementById("mode");
const hintEl = document.getElementById("hint");
const crosshairEl = document.getElementById("crosshair");
const winOverlay = document.getElementById("winOverlay");
document.getElementById("restartBtn").addEventListener("click", restart);

// ---------- THREE ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(8, 14, 6);
scene.add(dir);

// Texture helpers (optional)
const texLoader = new THREE.TextureLoader();
function tryLoadTexture(url, onOk) {
  texLoader.load(url, onOk, undefined, () => { /* ignore */ });
}
function setupRepeat(tex, repeatX, repeatY) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);
  tex.colorSpace = THREE.SRGBColorSpace;
}

// Ground
const groundGeo = new THREE.PlaneGeometry(worldW, worldD);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x101826, roughness: 0.95, metalness: 0.0 });

tryLoadTexture("./assets/ground.jpg", (tex) => {
  setupRepeat(tex, Math.max(1, worldW / 6), Math.max(1, worldD / 6));
  groundMat.map = tex;
  groundMat.needsUpdate = true;
});

const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI * 0.5;
ground.position.set(worldW * 0.5 - CONFIG.cellSize * 0.5, 0, worldD * 0.5 - CONFIG.cellSize * 0.5);
scene.add(ground);

// ---------- WALLS (InstancedMesh) ----------
const wallGeo = new THREE.BoxGeometry(CONFIG.wallSize, CONFIG.wallHeight, CONFIG.wallSize);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3347, roughness: 0.9, metalness: 0.0 });

tryLoadTexture("./assets/wall.jpg", (tex) => {
  setupRepeat(tex, 1, 1);
  wallMat.map = tex;
  wallMat.needsUpdate = true;
});

let wallCount = 0;
for (let r = 0; r < mazeRows; r++) for (let c = 0; c < mazeCols; c++) if (MAZE[r][c] === 1) wallCount++;

const wallsInst = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
wallsInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
scene.add(wallsInst);

// Cached AABBs for collision
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

      const min = new THREE.Vector3(pos.x - half.x, pos.y - half.y, pos.z - half.z);
      const max = new THREE.Vector3(pos.x + half.x, pos.y + half.y, pos.z + half.z);
      wallBoxes.push(new THREE.Box3(min, max));

      idx++;
    }
  }
  wallsInst.instanceMatrix.needsUpdate = true;
}

// ---------- PLAYER ----------
const playerGeo = new THREE.SphereGeometry(CONFIG.playerRadius, 18, 14);
const playerMat = new THREE.MeshStandardMaterial({ color: 0x7bd7ff, roughness: 0.35, metalness: 0.0 });
const player = new THREE.Mesh(playerGeo, playerMat);

const startPos = gridToWorld(START.r, START.c);
player.position.set(startPos.x, CONFIG.playerY, startPos.z);
scene.add(player);

// ---------- GOAL ----------
const goalGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
const goalMat = new THREE.MeshStandardMaterial({
  color: 0xffd36a,
  emissive: 0xff9b2f,
  emissiveIntensity: 1.1,
  roughness: 0.3,
  metalness: 0.0
});
const goal = new THREE.Mesh(goalGeo, goalMat);
const goalPos = gridToWorld(GOAL.r, GOAL.c);
goal.position.set(goalPos.x, 0.55, goalPos.z);
scene.add(goal);

// ---------- INPUT ----------
const input = { up:false, down:false, left:false, right:false };
const isFinePointer = matchMedia("(pointer:fine)").matches;

function setKey(e, isDown) {
  const k = e.key.toLowerCase();
  if (k === "w" || k === "arrowup") input.up = isDown;
  if (k === "s" || k === "arrowdown") input.down = isDown;
  if (k === "a" || k === "arrowleft") input.left = isDown;
  if (k === "d" || k === "arrowright") input.right = isDown;
}

window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "c") toggleCameraMode();
  setKey(e, true);
});
window.addEventListener("keyup", (e) => setKey(e, false));

// Prevent stuck keys when tab out
window.addEventListener("blur", () => {
  input.up = input.down = input.left = input.right = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) input.up = input.down = input.left = input.right = false;
});

// Mobile hold buttons
bindHoldButton("btnUp", "up");
bindHoldButton("btnDown", "down");
bindHoldButton("btnLeft", "left");
bindHoldButton("btnRight", "right");

function bindHoldButton(id, dirKey) {
  const el = document.getElementById(id);
  if (!el) return;

  const onDown = (e) => { e.preventDefault(); input[dirKey] = true; };
  const onUp   = (e) => { e.preventDefault(); input[dirKey] = false; };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("pointerleave", onUp);
}

// ---------- GAME STATE ----------
let hasWon = false;

function showWin() {
  hasWon = true;
  winOverlay.classList.remove("hidden");
  statusEl.textContent = "Win!";
}
function restart() {
  hasWon = false;
  winOverlay.classList.add("hidden");
  player.position.set(startPos.x, CONFIG.playerY, startPos.z);
  statusEl.textContent = "Reach the goal! (Press C to toggle camera)";
}

// ---------- CAMERA MODES ----------
const CameraMode = { TopDown: 0, FPS: 1 };
let camMode = CameraMode.TopDown;

let yaw = 0;
let pitch = 0;

function setHudMode() {
  if (camMode === CameraMode.TopDown) {
    modeEl.textContent = "Mode: Top-Down";
    hintEl.style.display = "none";
    crosshairEl.classList.add("hidden");
  } else {
    modeEl.textContent = "Mode: First-Person";
    hintEl.style.display = isFinePointer ? "block" : "none";
    crosshairEl.classList.remove("hidden");
  }
}
setHudMode();

function toggleCameraMode() {
  camMode = (camMode === CameraMode.TopDown) ? CameraMode.FPS : CameraMode.TopDown;
  if (camMode === CameraMode.TopDown && document.pointerLockElement) document.exitPointerLock();
  setHudMode();
}

// Pointer lock + mouse look (FPS)
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (camMode !== CameraMode.FPS) return;
  if (!isFinePointer) return;
  if (e.button !== 0) return;
  if (!document.pointerLockElement) renderer.domElement.requestPointerLock();
});

document.addEventListener("mousemove", (e) => {
  if (camMode !== CameraMode.FPS) return;
  if (document.pointerLockElement !== renderer.domElement) return;

  yaw -= e.movementX * CONFIG.mouseSensitivity;
  pitch -= e.movementY * CONFIG.mouseSensitivity;
  pitch = Math.max(-CONFIG.maxPitch, Math.min(CONFIG.maxPitch, pitch));
});

// ---------- COLLISION (Sphere vs AABB push-out) ----------
const tmpClosest = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

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
        // inside/edge case: push out by smallest axis in XZ
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

// ---------- MOVEMENT ----------
function movePlayer(dt) {
  let mx = 0;
  let mz = 0;

  if (camMode === CameraMode.FPS) {
    const forwardIntent = (input.up ? 1 : 0) + (input.down ? -1 : 0);
    const rightIntent   = (input.right ? -1 : 0) + (input.left ? 1 : 0);


    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    mx = rx * rightIntent + fx * forwardIntent;
    mz = rz * rightIntent + fz * forwardIntent;

    const l2 = Math.hypot(mx, mz);
    if (l2 > 0) { mx /= l2; mz /= l2; }
  } else {
    if (input.left)  mx -= 1;
    if (input.right) mx += 1;
    if (input.up)    mz -= 1;
    if (input.down)  mz += 1;

    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
  }

  const step = CONFIG.moveSpeed * dt;

  const next = player.position.clone();
  next.x += mx * step;
  next.z += mz * step;
  next.y = CONFIG.playerY;

  resolveSphereAABBCollisions(next, CONFIG.playerRadius);

  player.position.copy(next);

  // Visual polish: rotate player when topdown
  if (camMode === CameraMode.TopDown) {
    if (mx !== 0 || mz !== 0) player.rotation.y = Math.atan2(mx, mz);
  }
}

// ---------- CAMERA UPDATE ----------
const camTarget = new THREE.Vector3();
const desiredCamPos = new THREE.Vector3();

function updateCamera() {
  if (camMode === CameraMode.TopDown) {
    camTarget.set(player.position.x, 0, player.position.z);
    desiredCamPos.set(player.position.x, CONFIG.topDownHeight, player.position.z + 0.001);
    camera.position.lerp(desiredCamPos, CONFIG.topDownLerp);
    camera.lookAt(camTarget);
    return;
  }

  desiredCamPos.set(player.position.x, CONFIG.fpsEyeHeight, player.position.z);
  camera.position.lerp(desiredCamPos, CONFIG.fpsLerp);

  const dir = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  );

  camTarget.copy(camera.position).add(dir);
  camera.lookAt(camTarget);
}

// ---------- MINIMAP ----------
const miniCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
miniCam.up.set(0, 0, -1);
miniCam.lookAt(0, -1, 0);

function updateMinimapCamera() {
  const halfW = (worldW * 0.5) + CONFIG.minimapWorldMargin;
  const halfD = (worldD * 0.5) + CONFIG.minimapWorldMargin;

  const centerX = worldW * 0.5 - CONFIG.cellSize * 0.5;
  const centerZ = worldD * 0.5 - CONFIG.cellSize * 0.5;

  miniCam.position.set(centerX, 40, centerZ);
  miniCam.left = -halfW;
  miniCam.right = halfW;
  miniCam.top = halfD;
  miniCam.bottom = -halfD;
  miniCam.updateProjectionMatrix();

  const w = renderer.domElement.width;
  const h = renderer.domElement.height;

  const pxSize = Math.min(CONFIG.minimapSize, Math.min(w, h) - CONFIG.minimapPadding * 2);
  const x = w - pxSize - CONFIG.minimapPadding;
  const y = h - pxSize - CONFIG.minimapPadding;

  return { x, y, s: pxSize };
}

// ---------- LOOP ----------
let lastT = performance.now();
function animate(t) {
  requestAnimationFrame(animate);

  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (!hasWon) {
    movePlayer(dt);

    if (player.position.distanceTo(goal.position) <= CONFIG.winDistance) {
      showWin();
    }
  }

  goal.rotation.y += dt * 1.3;

  updateCamera();

  // Main render
  renderer.clear();
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);

  // Minimap render
  const vp = updateMinimapCamera();
  renderer.setScissorTest(true);
  renderer.setViewport(vp.x, vp.y, vp.s, vp.s);
  renderer.setScissor(vp.x, vp.y, vp.s, vp.s);
  renderer.render(scene, miniCam);
  renderer.setScissorTest(false);
}
requestAnimationFrame(animate);

// ---------- RESIZE ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
});
