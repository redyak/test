import * as THREE from 'three';

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');

function setError(msg) {
  if (scoreEl) scoreEl.textContent = 'ERROR: ' + msg;
  console.error(msg);
}

const GRID_SIZE = 6;

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
  }
];

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

  // Strict containment check: the WHOLE shape footprint must fit inside the
  // grid — used to validate drag moves (no partial/out-of-bounds placement).
  function fitsInGrid(gridCol, gridRow, gridWidth, gridDepth) {
    return (
      gridCol >= 0 &&
      gridRow >= 0 &&
      gridCol + gridWidth <= GRID_SIZE &&
      gridRow + gridDepth <= GRID_SIZE
    );
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

  function gridToWorldXZ(gridCol, gridRow, shape) {
    return {
      x: cellCenterWorld(gridCol) + (shape.gridWidth - 1) / 2,
      z: cellCenterWorld(gridRow) + (shape.gridDepth - 1) / 2
    };
  }

  function spawnFallingObject(gridCol = 0, gridRow = 0) {
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const { x: worldX, z: worldZ } = gridToWorldXZ(gridCol, gridRow, shape);

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

  // Attempts to nudge a still-falling object by one grid cell along dCol/dRow.
  // Rejects the move (returns false) if the object is no longer falling, or
  // if the shape would land partly/fully outside the 6x6x6 cube.
  function tryMoveFallingObject(obj, dCol, dRow) {
    if (!obj || obj.landed) return false;
    const newCol = obj.gridCol + dCol;
    const newRow = obj.gridRow + dRow;
    if (!fitsInGrid(newCol, newRow, obj.shape.gridWidth, obj.shape.gridDepth)) return false;

    obj.gridCol = newCol;
    obj.gridRow = newRow;
    const { x, z } = gridToWorldXZ(newCol, newRow, obj.shape);
    obj.group.position.x = x;
    obj.group.position.z = z;
    return true;
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
  // for rotation. Kept separate from the rest of the canvas/screen so it
  // doesn't conflict with dragging the falling object (below).
  const rotationZone = document.createElement('div');
  rotationZone.id = 'rotation-zone';
  rotationZone.setAttribute('aria-label', 'Rotate cube left or right');
  rotationZone.innerHTML = `
    <svg viewBox="0 0 48 48" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <path d="M20 31L24 35L20 39" stroke="#8fe8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M32 34.1679C39.0636 32.6248 44 29.1006 44 25C44 19.4772 35.0457 15 24 15C12.9543 15 4 19.4772 4 25C4 30.5228 12.9543 35 24 35" stroke="#8fe8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
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

  // ========== FALLING-OBJECT DRAG (canvas only) ==========
  // Dragging on the main canvas nudges the currently-falling object by one
  // grid cell along whichever LOCAL axis (X or Z, relative to the cube's
  // current rotation) the swipe most closely matches. Only active while an
  // object is falling, and only applied if the destination keeps the whole
  // shape inside the grid.

  function worldToScreen(vec3) {
    const v = vec3.clone().project(camera);
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  const OBJECT_DRAG_LOCK_PX = 12;   // min movement before an axis is locked in
  const OBJECT_DRAG_MOVE_PX = 55;   // movement along the locked axis needed to trigger a 1-cell move

  let objectDrag = null; // { obj, startX, startY, axis: 'col'|'row'|null, sign, applied }

  canvas.addEventListener('pointerdown', (event) => {
    const obj = fallingObjects.find(o => !o.landed);
    if (!obj) return;
    objectDrag = {
      obj,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      sign: 0,
      applied: false
    };
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!objectDrag) return;
    const { obj } = objectDrag;
    if (obj.landed) {
      objectDrag = null;
      canvas.style.cursor = 'grab';
      return;
    }

    const deltaX = event.clientX - objectDrag.startX;
    const deltaY = event.clientY - objectDrag.startY;

    if (!objectDrag.axis) {
      if (Math.hypot(deltaX, deltaY) < OBJECT_DRAG_LOCK_PX) return;

      // Project the cube's local +X and +Z axes (accounting for current
      // rotation) into screen space to find which grid axis the swipe
      // direction actually corresponds to on-screen.
      const originWorld = obj.group.getWorldPosition(new THREE.Vector3());
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(cubeGroup.quaternion);
      const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(cubeGroup.quaternion);

      const originScreen = worldToScreen(originWorld);
      const xScreen = worldToScreen(originWorld.clone().add(localX));
      const zScreen = worldToScreen(originWorld.clone().add(localZ));

      const dirCol = { x: xScreen.x - originScreen.x, y: xScreen.y - originScreen.y };
      const dirRow = { x: zScreen.x - originScreen.x, y: zScreen.y - originScreen.y };

      const normalize = (v) => {
        const len = Math.hypot(v.x, v.y) || 1;
        return { x: v.x / len, y: v.y / len };
      };
      const nCol = normalize(dirCol);
      const nRow = normalize(dirRow);
      const nDrag = normalize({ x: deltaX, y: deltaY });

      const dotCol = nDrag.x * nCol.x + nDrag.y * nCol.y;
      const dotRow = nDrag.x * nRow.x + nDrag.y * nRow.y;

      if (Math.abs(dotCol) >= Math.abs(dotRow)) {
        objectDrag.axis = 'col';
        objectDrag.sign = dotCol >= 0 ? 1 : -1;
      } else {
        objectDrag.axis = 'row';
        objectDrag.sign = dotRow >= 0 ? 1 : -1;
      }
    }

    if (!objectDrag.applied && Math.hypot(deltaX, deltaY) >= OBJECT_DRAG_MOVE_PX) {
      const dCol = objectDrag.axis === 'col' ? objectDrag.sign : 0;
      const dRow = objectDrag.axis === 'row' ? objectDrag.sign : 0;
      tryMoveFallingObject(obj, dCol, dRow);
      objectDrag.applied = true; // one nudge per drag gesture
    }
  });

  const stopObjectDrag = () => {
    objectDrag = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', stopObjectDrag);
  canvas.addEventListener('pointercancel', stopObjectDrag);
  canvas.addEventListener('pointerleave', stopObjectDrag);
  canvas.style.cursor = 'grab';

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
