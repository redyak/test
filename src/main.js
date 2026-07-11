import * as THREE from 'three';

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');

// Helper to display errors on-screen
function setError(msg) {
  if (scoreEl) scoreEl.textContent = 'ERROR: ' + msg;
  console.error(msg);
}

try {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#040816');
  scene.fog = new THREE.Fog('#040816', 10, 30);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(15, 10, 15);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const ambientLight = new THREE.AmbientLight(0xa6c1ff, 0.9);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(6, 10, 8);
scene.add(directionalLight);

const cubeGroup = new THREE.Group();
scene.add(cubeGroup);

const cubeSize = 6;
const cubeHalfSize = cubeSize / 2;

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize),
  new THREE.MeshStandardMaterial({
    color: 0x6ea8ff,
    emissive: 0x103a71,
    emissiveIntensity: 0.35,
    roughness: 0.4,
    metalness: 0.1,
    transparent: true,
    opacity: 0.15
  })
);
cubeGroup.add(cube);

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize)),
  new THREE.LineBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.6 })
);
cubeGroup.add(outline);

// Multi-cube spawner: allow multiple falling items and occupancy-aware landing
var fallingCubes = [];
var spawnedCubes=0
const smallHalf = 1; // half-size of the small cube (2x2x2)

const fallPathMaterial = new THREE.LineDashedMaterial({
  color: 0xffff66,
  dashSize: 0.5,
  gapSize: 0.15,
  transparent: true,
  opacity: 1,
  depthTest: false
});

// Initialize occupancy grid BEFORE spawning
const occupancy = Array.from({ length: 6 }, () => Array(6).fill(0));
const gridCenters = Array.from({ length: 6 }, (_, i) => -cubeHalfSize + 0.5 + i);

function footprintIndicesAt(objX, objZ, objHalf) {
  const cols = [];
  for (let i = 0; i < 6; i++) {
    const cx = gridCenters[i];
    if (cx >= objX - objHalf && cx < objX + objHalf) {
      for (let j = 0; j < 6; j++) {
        const cz = gridCenters[j];
        if (cz >= objZ - objHalf && cz < objZ + objHalf) {
          cols.push([i, j]);
        }
      }
    }
  }
  return cols;
}

function computeTargetYFor(objX, objZ, objHalf, objHeight) {
  const cols = footprintIndicesAt(objX, objZ, objHalf);
  let maxLayer = 0;
  if (cols.length === 0) return -cubeHalfSize + objHeight / 2;
  cols.forEach(([i, j]) => {
    if (occupancy[i][j] > maxLayer) maxLayer = occupancy[i][j];
  });
  return -cubeHalfSize + objHeight / 2 + maxLayer;
}

function spawnFallingCube(x = 0, z = 0) {
  const group = new THREE.Group();
  const startY = cubeHalfSize + 2; // spawn above the large cube
  group.position.set(x, startY, z);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({
      color: 0x8fe8ff,
      emissive: 0x144b7a,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.3
    })
  );
  group.add(mesh);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
  );
  group.add(outline);

  cubeGroup.add(group);

  // Compute target landing Y based on current occupancy
  const objHalf = smallHalf;
  const objHeight = 2;
  const targetY = computeTargetYFor(x, z, objHalf, objHeight);

  // create four dashed corner path lines
  const cornerOffsets = [
    { x: smallHalf, z: smallHalf },
    { x: smallHalf, z: -smallHalf },
    { x: -smallHalf, z: smallHalf },
    { x: -smallHalf, z: -smallHalf }
  ];
  const pathLines = cornerOffsets.map((off) => {
    const start = new THREE.Vector3(off.x, group.position.y - smallHalf, off.z);
    const end = new THREE.Vector3(off.x, targetY - smallHalf, off.z);
    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geom, fallPathMaterial);
    line.computeLineDistances?.();
    line.renderOrder = 999;
    cubeGroup.add(line);
    return { line, off };
  });

  const obj = { group, mesh, pathLines, landed: false };
  fallingCubes.push(obj);
  spawnedCubes++;
  return obj;
}

// start with one falling cube
spawnFallingCube(0, 2);
const gridMaterial = new THREE.LineBasicMaterial({ color: 0x7fffff, transparent: true, opacity: 0.18 });
const gridSize = 6;
const gridDivisions = 6;

const grids = [
  new THREE.GridHelper(gridSize, gridDivisions, 0x7fe3ff, 0x7fe3ff)
];

grids.forEach((grid, index) => {
  grid.material = gridMaterial;
  grid.material.depthWrite = false;
  grid.material.opacity = 0.16;
  grid.material.transparent = true;

  cubeGroup.add(grid);
});

// Falling animation
let isFalling = true;
const fallSpeed = 0.02;

let isDragging = false;
let lastX = 0;

renderer.domElement.style.cursor = 'grab';
renderer.domElement.addEventListener('pointerdown', (event) => {
  isDragging = true;
  lastX = event.clientX;
  renderer.domElement.style.cursor = 'grabbing';
  renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!isDragging) return;
  const deltaX = event.clientX - lastX;
  cubeGroup.rotation.y += deltaX * 0.01;
  lastX = event.clientX;
});

const stopDragging = () => {
  isDragging = false;
  renderer.domElement.style.cursor = 'grab';
};

renderer.domElement.addEventListener('pointerup', stopDragging);
renderer.domElement.addEventListener('pointercancel', stopDragging);
renderer.domElement.addEventListener('pointerleave', stopDragging);

function animate() {
  requestAnimationFrame(animate);

  // Animate all falling cubes with occupancy-aware landing
  for (let idx = 0; idx < fallingCubes.length; idx++) {
    const c = fallingCubes[idx];
    if (c.landed) continue;
    const objX = c.group.position.x;
    const objZ = c.group.position.z;
    const objHalf = smallHalf;
    const objHeight = 2;
    const targetY = computeTargetYFor(objX, objZ, objHalf, objHeight);

    if (c.group.position.y > targetY) {
      c.group.position.y -= fallSpeed;
    } else {
      // land: snap to target and update occupancy
      c.group.position.y = targetY;
      c.landed = true;
      const cols = footprintIndicesAt(objX, objZ, objHalf);
      cols.forEach(([i, j]) => {
        occupancy[i][j] += objHeight; // mark occupied by the full object height (2)
      });
  
  // Remove path lines from scene
  c.pathLines.forEach(({ line }) => cubeGroup.remove(line));
  // Remove cube from tracking array
  fallingCubes=fallingCubes.filter(obj => obj !== c);
 
  // Spawn new cube
  if (spawnedCubes < 4) spawnFallingCube(0, 0);

    }

    // Update each corner path to follow the falling cube's bottom corners
    c.pathLines.forEach(({ line, off }) => {
      const start = new THREE.Vector3(off.x, c.group.position.y - smallHalf, off.z);
      const end = new THREE.Vector3(off.x, targetY - smallHalf, off.z);
      line.geometry.setFromPoints([start, end]);
      line.computeLineDistances?.();
    });
  }
  
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

  scoreEl.textContent = 'Cube falling...';
  animate();
} catch (err) {
  const errMsg = err && err.message ? err.message : String(err);
  setError(errMsg);
}

// Debug: expose occupancy to window for quick inspection
window.__occupancy = occupancy;
window.__fallingCubes = fallingCubes;
