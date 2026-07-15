import * as THREE from 'three';

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');

// Helper to display errors on-screen
function setError(msg) {
  if (scoreEl) scoreEl.textContent = 'ERROR: ' + msg;
  console.error(msg);
}

// ========== GRID CONSTANTS ==========
const GRID_SIZE = 6; // 6x6 cells in the footprint plane

// ========== SHAPE DEFINITIONS ==========
// Shapes are now defined purely in integer grid cells (gridWidth x gridDepth)
// instead of world-space half-extents (halfX/halfZ).
const SHAPES = [
  {
    name: 'cube',
    geometry: new THREE.BoxGeometry(2, 2, 2),
    gridWidth: 2,   // cells occupied along X
    gridDepth: 2,   // cells occupied along Z
    height: 2,      // world-unit height (layer thickness)
    color: 0x8fe8ff
  },
  {
    name: 'stick',
    geometry: new THREE.BoxGeometry(1, 1, 3),
    gridWidth: 1,
    gridDepth: 3,
    height: 1,
    color: 0xff8888
  }/*,
  {
    name: 'lshape',
    geometry: createLShapeGeometry(),
    gridWidth: 3,
    gridDepth: 2,
    height: 1,
    color: 0x88ff88
  }*/
];

// Helper to create L-shape (3x1 base + 1x1 attached)
function createLShapeGeometry() {
  const unitGeo = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.BufferGeometry();
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
  const cubeHalfSize = cubeSize / 2; // still needed once, to center the world on the grid

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

  const fallPathMaterial = new THREE.LineDashedMaterial({
    color: 0xffff66,
    dashSize: 0.5,
    gapSize: 0.15,
    transparent: true,
    opacity: 1,
    depthTest: false
  });

  // Occupancy grid: purely integer indices [0, GRID_SIZE)
  const occupancy = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

  // Converts a grid cell's integer index to its world-space center coordinate.
  // This is the only place a "half" appears, and it's a render-space concern,
  // not part of the grid/footprint/occupancy logic.
  function cellCenterWorld(index) {
    return index - cubeHalfSize + 0.5;
  }

  // Pure integer footprint: gridCol/gridRow are the index of the shape's
  // minimum corner cell; gridWidth/gridDepth are its size in cells.
  function footprintIndices(gridCol, gridRow, gridWidth, gridDepth) {
    const cells = [];
    for (let i = gridCol; i < gridCol + gridWidth; i++) {
      if (i < 0 || i >= GRID_SIZE) continue;
      for (let j = gridRow; j < gridRow + gridDepth; j++) {
        if (j < 0 || j >= GRID_SIZE) continue;
        cells.push([i, j]);
      }
    }
    return cells;
  }

  function computeTargetYFor(gridCol, gridRow, gridWidth, gridDepth, objHeight) {
    const cells = footprintIndices(gridCol, gridRow, gridWidth, gridDepth);
    let maxLayer = 0;
    if (cells.length === 0) return -cubeHalfSize + objHeight / 2;
    cells.forEach(([i, j]) => {
      if (occupancy[i][j] > maxLayer) maxLayer = occupancy[i][j];
    });
    return -cubeHalfSize + objHeight / 2 + maxLayer;
  }

  // gridCol/gridRow are now integer grid indices (the shape's minimum corner),
  // not world coordinates.
  function spawnFallingObject(gridCol = 0, gridRow = 0) {
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];

    // World-space center, derived from the grid corner + shape size.
    const worldX = cellCenterWorld(gridCol) + (shape.gridWidth - 1) / 2;
    const worldZ = cellCenterWorld(gridRow) + (shape.gridDepth - 1) / 2;

    const group = new THREE.Group();
    const startY = cubeHalfSize + 2;
    group.position.set(worldX, startY, worldZ);

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

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(shape.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    group.add(outline);

    cubeGroup.add(group);

    const targetY = computeTargetYFor(gridCol, gridRow, shape.gridWidth, shape.gridDepth, shape.height);

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

    const obj = {
      group,
      mesh,
      pathLines,
      landed: false,
      shape,
      gridCol,
      gridRow
    };
    fallingObjects.push(obj);
    spawnedCount++;
    return obj;
  }

  // Start with one falling object (grid corner at col 0, row 2)
  spawnFallingObject(0, 2);

  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x7fffff, transparent: true, opacity: 0.18 });
  const grids = [new THREE.GridHelper(cubeSize, GRID_SIZE, 0x7fe3ff, 0x7fe3ff)];
  grids.forEach((grid) => {
    grid.material = gridMaterial;
    grid.material.depthWrite = false;
    grid.material.opacity = 0.16;
    grid.material.transparent = true;
    cubeGroup.add(grid);
  });

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

      const targetY = computeTargetYFor(c.gridCol, c.gridRow, c.shape.gridWidth, c.shape.gridDepth, c.shape.height);

      if (c.group.position.y > targetY) {
        c.group.position.y -= fallSpeed;
      } else {
        c.group.position.y = targetY;
        c.landed = true;
        const cells = footprintIndices(c.gridCol, c.gridRow, c.shape.gridWidth, c.shape.gridDepth);
        cells.forEach(([i, j]) => {
          occupancy[i][j] += c.shape.height;
        });

        c.pathLines.forEach(({ line }) => cubeGroup.remove(line));
        fallingObjects = fallingObjects.filter(obj => obj !== c);

        if (spawnedCount < 6) spawnFallingObject(1, 0);
      }

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
