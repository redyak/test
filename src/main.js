import * as THREE from 'three';

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');

// Helper to display errors on-screen
function setError(msg) {
  if (scoreEl) scoreEl.textContent = 'ERROR: ' + msg;
  console.error(msg);
}

// ========== SHAPE DEFINITIONS ==========
// Define the 3 possible shapes with their geometries and dimensions
const SHAPES = [
  {
    name: 'cube',
    geometry: new THREE.BoxGeometry(2, 2, 2),
    halfX: 1,
    halfZ: 1,
    height: 2,
    color: 0x8fe8ff
  },
  {
    name: 'stick',
    geometry: new THREE.BoxGeometry(1, 1, 3),
    halfX: 0.5,
    halfZ: 1.5,
    height: 1,
    color: 0xff8888
  }/*,
  {
    name: 'lshape',
    geometry: createLShapeGeometry(),
    halfX: 1.5,
    halfZ: 1.0,
    height: 1,
    color: 0x88ff88
  }*/
];

// Helper to create L-shape (3x1 base + 1x1 attached)
function createLShapeGeometry() {
  const unitGeo = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.BufferGeometry();
  // Positions: 3 cubes in a row (X-axis) + 1 cube attached to the end (Z-axis)
  const positions = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 1 }
  ];
  positions.forEach(({ x, y, z }) => {
    const cubeGeo = unitGeo.clone();
    cubeGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
    geometry.merge(cubeGeo, 0);
  });
  return geometry;
}

function getBottomCornerOffsets(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const bottomY = box.min.y;
  return [
    new THREE.Vector3(box.min.x, bottomY, box.min.z),
    new THREE.Vector3(box.max.x, bottomY, box.min.z),
    new THREE.Vector3(box.max.x, bottomY, box.max.z),
    new THREE.Vector3(box.min.x, bottomY, box.max.z)
  ].map(corner => corner.clone().applyMatrix4(mesh.matrix));
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

  // Multi-shape spawner
  let fallingObjects = [];
  let spawnedCount = 0;
  const smallHalf = 1;

  const fallPathMaterial = new THREE.LineDashedMaterial({
    color: 0xffff66,
    dashSize: 0.5,
    gapSize: 0.15,
    transparent: true,
    opacity: 1,
    depthTest: false
  });

  // Initialize occupancy grid
  const occupancy = Array.from({ length: 6 }, () => Array(6).fill(0));
  const gridCenters = Array.from({ length: 6 }, (_, i) => -cubeHalfSize + 0.5 + i);

  // Updated to use halfX and halfZ
  function footprintIndicesAt(objX, objZ, halfX, halfZ) {
    const cols = [];
    for (let i = 0; i < 6; i++) {
      const cx = gridCenters[i];
      if (cx >= objX - halfX && cx < objX + halfX) {
        for (let j = 0; j < 6; j++) {
          const cz = gridCenters[j];
          if (cz >= objZ - halfZ && cz < objZ + halfZ) {
            cols.push([i, j]);
          }
        }
      }
    }
    return cols;
  }

  // Updated to use shape dimensions
  function computeTargetYFor(objX, objZ, halfX, halfZ, objHeight) {
    const cols = footprintIndicesAt(objX, objZ, halfX, halfZ);
    let maxLayer = 0;
    if (cols.length === 0) return -cubeHalfSize + objHeight / 2;
    cols.forEach(([i, j]) => {
      if (occupancy[i][j] > maxLayer) maxLayer = occupancy[i][j];
    });
    return -cubeHalfSize + objHeight / 2 + maxLayer;
  }

  function spawnFallingObject(x = 0, z = 0) {
    const group = new THREE.Group();
    const startY = cubeHalfSize + 2;
    group.position.set(x, startY, z);

    // Randomly select a shape
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];

    // Create mesh with shape's geometry and color
    const mesh = new THREE.Mesh(
      shape.geometry,
      new THREE.MeshStandardMaterial({
        color: shape.color,
        emissive: 0x144b7a,
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.3
      })
    );
    group.add(mesh);

    // Create outline
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(shape.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    group.add(outline);

    cubeGroup.add(group);

    // Compute target Y using shape's dimensions
    const targetY = computeTargetYFor(x, z, shape.halfX, shape.halfZ, shape.height);

    // Get bottom corners
    const bottomCornerOffsets = getBottomCornerOffsets(mesh);
    const pathLines = bottomCornerOffsets.map((offset) => {
      const start = new THREE.Vector3(
        group.position.x + offset.x,
        group.position.y + offset.y,
        group.position.z + offset.z
      );
      const end = new THREE.Vector3(start.x, targetY, start.z);
      const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geom, fallPathMaterial);
      line.computeLineDistances?.();
      line.renderOrder = 999;
      cubeGroup.add(line);
      return { line, offset };
    });

    // Store shape reference for later use in animate()
    const obj = {
      group,
      mesh,
      pathLines,
      landed: false,
      shape: shape
    };
    fallingObjects.push(obj);
    spawnedCount++;
    return obj;
  }

  // Start with one falling object
  spawnFallingObject(0, 2);

  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x7fffff, transparent: true, opacity: 0.18 });
  const gridSize = 6;
  const gridDivisions = 6;

  const grids = [new THREE.GridHelper(gridSize, gridDivisions, 0x7fe3ff, 0x7fe3ff)];
  grids.forEach((grid) => {
    grid.material = gridMaterial;
    grid.material.depthWrite = false;
    grid.material.opacity = 0.16;
    grid.material.transparent = true;
    cubeGroup.add(grid);
  });

  // Falling animation
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

    for (let idx = 0; idx < fallingObjects.length; idx++) {
      const c = fallingObjects[idx];
      if (c.landed) continue;

      const objX = c.group.position.x;
      const objZ = c.group.position.z;
      // Use the object's shape dimensions
      const targetY = computeTargetYFor(objX, objZ, c.shape.halfX, c.shape.halfZ, c.shape.height);

      if (c.group.position.y > targetY) {
        c.group.position.y -= fallSpeed;
      } else {
        // Land: snap to target and update occupancy
        c.group.position.y = targetY;
        c.landed = true;
        const cols = footprintIndicesAt(objX, objZ, c.shape.halfX, c.shape.halfZ);
        cols.forEach(([i, j]) => {
          occupancy[i][j] += c.shape.height;
        });

        // Cleanup
        c.pathLines.forEach(({ line }) => cubeGroup.remove(line));
        fallingObjects = fallingObjects.filter(obj => obj !== c);

        // Spawn next object
        if (spawnedCount < 6) spawnFallingObject(1, 0);
      }

      // Update path lines
      c.pathLines.forEach(({ line, offset }) => {
        const start = new THREE.Vector3(
          c.group.position.x + offset.x,
          c.group.position.y + offset.y,
          c.group.position.z + offset.z
        );
        const end = new THREE.Vector3(start.x, targetY, start.z);
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

  scoreEl.textContent = 'Shapes falling...';
  animate();
} catch (err) {
  const errMsg = err && err.message ? err.message : String(err);
  setError(errMsg);
}

// Debug
window.__occupancy = occupancy;
window.__fallingObjects = fallingObjects;
