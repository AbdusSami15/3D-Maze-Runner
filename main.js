import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const CONFIG = {
  cellSize: 2,
  wallHeight: 1.6,
  wallSize: 2,

  playerRadius: 0.45,
  playerY: 0.45,
  moveSpeed: 3.2,

  topCamHeight: 40,
  orthoPadding: 1.12,

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

// Keep center consistent with grid placement style used in this project
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

ui.btnCam?.addEventListener("click", () => {
  // Static top camera only: disable this button visually if you want
});
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

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

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

// ---------- Static Top Camera (Full maze visible) ----------
function setStaticTopCamera() {
  camera.position.set(WORLD_CENTER.x, CONFIG.topCamHeight, WORLD_CENTER.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(WORLD_CENTER.x, 0, WORLD_CENTER.z);
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

  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

setStaticTopCamera();
fitTopOrthoCamera();

// ---------- UI ----------
let hasWon = false;

function setHud() {
  ui.mode && (ui.mode.textContent = "Mode: Top-Down");
  ui.hint && (ui.hint.style.display = "none");
  ui.crosshair && ui.crosshair.classList.add("hidden");
  ui.status && (ui.status.textContent = "Reach the goal!");
}
setHud();

function showWin() {
  hasWon = true;
  ui.winOverlay?.classList.remove("hidden");
  ui.status && (ui.status.textContent = "Win!");
}

function restart() {
  hasWon = false;
  ui.winOverlay?.classList.add("hidden");
  player.position.set(startPos.x, CONFIG.playerY, startPos.z);
  ui.status && (ui.status.textContent = "Reach the goal!");
}

// ---------- Collision (Sphere vs AABB) ----------
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

// ---------- Movement ----------
function movePlayer(dt) {
  let mx = 0;
  let mz = 0;

  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  if (input.up) mz -= 1;
  if (input.down) mz += 1;

  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }

  const step = CONFIG.moveSpeed * dt;

  const next = new THREE.Vector3(
    player.position.x + mx * step,
    CONFIG.playerY,
    player.position.z + mz * step
  );

  resolveSphereAABBCollisions(next, CONFIG.playerRadius);
  player.position.copy(next);

  if (mx !== 0 || mz !== 0) player.rotation.y = Math.atan2(mx, -mz);
}

// ---------- Loop ----------
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

  renderer.render(scene, camera);
}

requestAnimationFrame(loop);

// ---------- Resize ----------
function onResize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);

  setStaticTopCamera();
  fitTopOrthoCamera();
}

window.addEventListener("resize", onResize);
onResize();
