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
const SHAPES = [
  {
    name: 'cube',
    geometry: new THREE.BoxGeometry(2, 2, 2),
    gridWidth: 2,
    gridDepth: 2,
    height: 2,
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

  const occupancy = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

  function cellCenterWorld(index) {
    return index - cubeHalfSize + 0.5;
  }

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

  function spawnFallingObject(gridCol = 0, gridRow = 0) {
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];

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

  // ========== CUBE ROTATION ZONE ==========
  // A dedicated strip beneath the cube that alone captures left/right swipes
  // for rotation. Kept separate from the rest of the canvas/screen so other
  // controls added later won't fight with rotation gestures.
  const rotationZone = document.createElement('div');
  rotationZone.id = 'rotation-zone';
  rotationZone.setAttribute('aria-label', 'Rotate cube left or right');
  rotationZone.innerHTML = `
    <svg viewBox="0 0 200 70" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="rotArrowLeft" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto-start-reverse">
          <path d="M0,0 L9,4.5 L0,9 Z" fill="#8fe8ff"/>
        </marker>
        <marker id="rotArrowRight" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" fill="#8fe8ff"/>
        </marker>
      </defs>
      <path d="M22,55 A78,78 0 0 1 178,55"
            fill="none" stroke="#8fe8ff" stroke-width="4" stroke-linecap="round"
            marker-start="url(#rotArrowLeft)" marker-end="url(#rotArrowRight)" opacity="0.9"/>
    </svg>
  `;
  document.body.appendChild(rotationZone);

  const rotationZoneStyle = document.createElement('style');
  rotationZoneStyle.textContent = `
    #rotation-zone {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      width: 200px;
      height: 70px;
      z-index: 10;
      cursor: grab;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
      opacity: 0.5;
      transition: opacity 0.15s ease;
    }
    #rotation-zone:hover,
    #rotation-zone:active {
      opacity: 0.95;
    }
  `;
  document.head.appendChild(rotationZoneStyle);

  // Rotation is now driven entirely by pointer events on rotationZone,
  // NOT on renderer.domElement / the rest of the screen.
  let isDragging = false;
  let lastX = 0;

  rotationZone.addEventListener('pointerdown', (event) => {
    isDragging = true;
    lastX = event.clientX;
    rotationZone.style.cursor = 'grabbing';
    rotationZone.setPointerCapture(event.pointerId);
  });

  rotationZone.addEventListener('pointermove', (event) => {
    if (!isDragging) return;
    const deltaX = event.clientX - lastX;
    cubeGroup.rotation.y += deltaX * 0.01;
    lastX = event.clientX;
  });

  const stopDragging = () => {
    isDragging = false;
    rotationZone.style.cursor = 'grab';
  };
  rotationZone.addEventListener('pointerup', stopDragging);
  rotationZone.addEventListener('pointercancel', stopDragging);
  rotationZone.addEventListener('pointerleave', stopDragging);

  const fallSpeed = 0.02;

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

window.__occupancy = occupancy;
window.__fallingObjects = fallingObjects;
