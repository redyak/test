import * as THREE from 'three';

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');

function setError(msg) {
  if (scoreEl) scoreEl.textContent = 'ERROR: ' + msg;
  console.error(msg);
}

const GRID_SIZE = 6;
const MAX_SHAPES = 11;
const FALL_SPEED = 0.02;
const SPAWN_HEIGHT_OFFSET = 2;
const DEBUG = false;

const SHAPES = [
  {
    name: 'cube',
    cubes: [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 },
      { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }
    ],
    color: 0x8fe8ff
  },
  {
    name: 'stick',
    cubes: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 }
    ],
    color: 0xff8888
  },
  {
    name: 'L-shape',
    cubes: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 },
      { x: 1, y: 0, z: 0 }
    ],
    color: 0x88ff88
  },
  {
    name: 'T-shape',
    cubes: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 }
    ],
    color: 0xffff88
  }
];

function computeShapeProps(shape) {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  shape.cubes.forEach(c => {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  });
  return {
    gridWidth: maxX - minX + 1,
    gridDepth: maxZ - minZ + 1,
    height: maxY - minY + 1,
    minX, maxX, minZ, maxZ, minY, maxY
  };
}

// Computes the 4 bottom-face corner offsets (relative to the group's own
// local origin) for a shape, based on its current shapeProps. Since
// unitCubeGeometry cubes are centered at each cube's local integer position,
// the shape's local bounds run from -0.5 to (width - 0.5) on X/Z and bottom
// out at -0.5 on Y. This is purely local-space, so it's unaffected by the
// big cube's rotation or the group's world position — no double-transform.
function computeLocalBottomCorners(shapeProps) {
  const width = shapeProps.maxX - shapeProps.minX + 1;
  const depth = shapeProps.maxZ - shapeProps.minZ + 1;
  const minX = -0.5;
  const maxX = width - 0.5;
  const minZ = -0.5;
  const maxZ = depth - 0.5;
  const bottomY = -0.5;
  return [
    new THREE.Vector3(minX, bottomY, minZ),
    new THREE.Vector3(maxX, bottomY, minZ),
    new THREE.Vector3(maxX, bottomY, maxZ),
    new THREE.Vector3(minX, bottomY, maxZ)
  ];
}

try {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a1128');

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(15, 10, 15);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const ambientLight = new THREE.AmbientLight(0xa6c1ff, 1.1);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.6);
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
    new THREE.LineBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.85 })
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

  // 3D occupancy grid: occupancy[x][z][y] = true if occupied
  const occupancy = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false))
  );

  function cellCenterWorld(index) {
    return index - cubeHalfSize + 0.5;
  }

  function shapeOverlapsAt(gridCol, gridRow, shape, shapeProps, baseY) {
    for (const cube of shape.cubes) {
      const x = gridCol + cube.x - shapeProps.minX;
      const z = gridRow + cube.z - shapeProps.minZ;
      const y = baseY + cube.y - shapeProps.minY;
      if (y < 0 || y >= GRID_SIZE) return true;   // out of vertical bounds = blocked
      if (occupancy[x][z][y]) return true;         // collides with existing block
    }
    return false;
  }

  function computeTargetYFor(gridCol, gridRow, shape, shapeProps) {
    // horizontal bounds check
    for (const cube of shape.cubes) {
      const x = gridCol + cube.x - shapeProps.minX;
      const z = gridRow + cube.z - shapeProps.minZ;
      if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) return -1;
    }

    const shapeHeight = shapeProps.maxY - shapeProps.minY + 1;
    const topBase = GRID_SIZE - shapeHeight;
    if (topBase < 0) return -1;

    // If it's blocked even at the very top, the column is full.
    if (shapeOverlapsAt(gridCol, gridRow, shape, shapeProps, topBase)) return -1;

    // Simulate falling: start at the top and descend until one more step
    // down would cause a collision (or we hit the floor).
    let base = topBase;
    while (base > 0 && !shapeOverlapsAt(gridCol, gridRow, shape, shapeProps, base - 1)) {
      base--;
    }
    return base;
  }

  function fitsInGrid(gridCol, gridRow, shape, shapeProps) {
    return shape.cubes.every(cube => {
      const x = gridCol + cube.x - shapeProps.minX;
      const z = gridRow + cube.z - shapeProps.minZ;
      return x >= 0 && x < GRID_SIZE && z >= 0 && z < GRID_SIZE;
    });
  }

  function gridToWorldXZ(gridCol, gridRow) {
    return {
      x: cellCenterWorld(gridCol),
      z: cellCenterWorld(gridRow)
    };
  }

  // Pre-compute bounding box for unit cube
  const unitCubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  unitCubeGeometry.computeBoundingBox();

  // Updates each path line to run from the shape's current bottom corners
  // (recomputed fresh from shapeProps each call, so rotation is reflected
  // immediately) down to its landing height.
  function updatePathLines(obj, worldTargetY) {
    const bottomCornerOffsets = computeLocalBottomCorners(obj.shapeProps);
    obj.pathLines.forEach(({ line }, index) => {
      const offset = bottomCornerOffsets[index] || bottomCornerOffsets[0];
      const start = new THREE.Vector3(
        obj.group.position.x + offset.x,
        obj.group.position.y + offset.y,
        obj.group.position.z + offset.z
      );
      const end = new THREE.Vector3(start.x, worldTargetY, start.z);
      line.geometry.setFromPoints([start, end]);
      line.computeLineDistances?.();
    });
  }

  // Builds (or rebuilds) the fill + outline meshes for a shape's cubes
  // inside the given group. Clears any existing children first, so this
  // can be called again after a rotation changes the cube list.
  function buildShapeMeshes(group, cubes, shapeProps, material) {
    while (group.children.length) {
      group.remove(group.children[0]);
    }
    cubes.forEach(cube => {
      const position = [
        cube.x - shapeProps.minX,
        cube.y - shapeProps.minY,
        cube.z - shapeProps.minZ
      ];

      const mesh = new THREE.Mesh(unitCubeGeometry, material);
      mesh.position.set(...position);
      group.add(mesh);

      const cubeOutline = new THREE.LineSegments(
        new THREE.EdgesGeometry(unitCubeGeometry),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
      );
      cubeOutline.position.set(...position);
      group.add(cubeOutline);
    });
  }

  function spawnFallingObject(gridCol = 0, gridRow = 0) {
    const template = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    // Clone so rotating this instance never mutates the shared template.
    const shape = {
      name: template.name,
      color: template.color,
      cubes: template.cubes.map(c => ({ ...c }))
    };
    const shapeProps = computeShapeProps(shape);
    const { x: worldX, z: worldZ } = gridToWorldXZ(gridCol, gridRow);

    const group = new THREE.Group();
    const startY = cubeHalfSize + SPAWN_HEIGHT_OFFSET;
    group.position.set(worldX, startY, worldZ);

    const material = new THREE.MeshStandardMaterial({
      color: shape.color,
      emissive: 0x144b7a,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.3
    });

    buildShapeMeshes(group, shape.cubes, shapeProps, material);

    cubeGroup.add(group);
    group.updateMatrixWorld(true);

    const gridBaseY = computeTargetYFor(gridCol, gridRow, shape, shapeProps);
    const worldTargetY = gridBaseY - cubeHalfSize + 0.5;

    const bottomCornerOffsets = computeLocalBottomCorners(shapeProps);
    const pathLines = bottomCornerOffsets.map((offset) => {
      const start = new THREE.Vector3(
        group.position.x + offset.x,
        group.position.y + offset.y,
        group.position.z + offset.z
      );
      const end = new THREE.Vector3(start.x, worldTargetY, start.z);
      const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geom, fallPathMaterial);
      line.computeLineDistances?.();
      line.renderOrder = 999;
      cubeGroup.add(line);
      return { line, offset };
    });

    const obj = {
      group,
      material,
      pathLines,
      landed: false,
      shape,
      shapeProps,
      gridCol,
      gridRow,
      gridBaseY
    };
    fallingObjects.push(obj);
    spawnedCount++;
    return obj;
  }

  function tryMoveFallingObject(obj, dCol, dRow) {
    if (!obj || obj.landed) return false;
    const newCol = obj.gridCol + dCol;
    const newRow = obj.gridRow + dRow;
    if (!fitsInGrid(newCol, newRow, obj.shape, obj.shapeProps)) return false;

    // Reject a sideways move that would clip through a block at the
    // shape's current height (e.g. sliding under an overhang).
    if (shapeOverlapsAt(newCol, newRow, obj.shape, obj.shapeProps, obj.gridBaseY)) {
      return false;
    }

    const gridBaseY = computeTargetYFor(newCol, newRow, obj.shape, obj.shapeProps);
    if (gridBaseY < 0) return false;

    obj.gridCol = newCol;
    obj.gridRow = newRow;
    obj.gridBaseY = gridBaseY;
    const { x, z } = gridToWorldXZ(newCol, newRow);
    obj.group.position.x = x;
    obj.group.position.z = z;
    return true;
  }

  // Rotates a shape's cube list 90 degrees around 'y' or 'x' axis.
  // dir: +1 or -1 for direction of rotation.
  function rotateCubesAroundAxis(cubes, axis, dir) {
    return cubes.map(c => {
      if (axis === 'y') {
        return dir > 0
          ? { x: -c.z, y: c.y, z: c.x }
          : { x: c.z, y: c.y, z: -c.x };
      }
      // axis === 'x'
      return dir > 0
        ? { x: c.x, y: -c.z, z: c.y }
        : { x: c.x, y: c.z, z: -c.y };
    });
  }

  function tryRotateFallingObject(obj, axis, dir) {
    if (!obj || obj.landed) return false;

    const newCubes = rotateCubesAroundAxis(obj.shape.cubes, axis, dir);
    const newShapeProps = computeShapeProps({ cubes: newCubes });

    if (!fitsInGrid(obj.gridCol, obj.gridRow, { cubes: newCubes }, newShapeProps)) {
      return false;
    }

    const gridBaseY = computeTargetYFor(obj.gridCol, obj.gridRow, { cubes: newCubes }, newShapeProps);
    if (gridBaseY < 0) return false;

    obj.shape.cubes = newCubes;
    obj.shapeProps = newShapeProps;
    obj.gridBaseY = gridBaseY;
    buildShapeMeshes(obj.group, newCubes, newShapeProps, obj.material);

    // If the rotation raises the resting height, snap up so the shape
    // doesn't visually clip through the block it now rests on.
    const worldTargetY = gridBaseY - cubeHalfSize + 0.5;
    if (obj.group.position.y < worldTargetY) {
      obj.group.position.y = worldTargetY;
    }

    return true;
  }

  spawnFallingObject(0, 2);

  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x7fffff, transparent: true, opacity: 0.3 });
  const grids = [new THREE.GridHelper(cubeSize, GRID_SIZE, 0x7fe3ff, 0x7fe3ff)];
  grids.forEach((grid) => {
    grid.material = gridMaterial;
    grid.material.depthWrite = false;
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    cubeGroup.add(grid);
  });

  // ========== FALLING-SHAPE MOVE ZONE ==========
  const rotationZone = document.createElement('div');
  rotationZone.id = 'rotation-zone';
  rotationZone.setAttribute('aria-label', 'Move falling shape left, right, forward, or back');
  rotationZone.innerHTML = `
    <svg viewBox="0 0 48 48" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <g id="move-arrows" style="transform-origin: 24px 24px;">
        <path d="M14 24H4M4 24L9 19M4 24L9 29" stroke="#8fe8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M34 24H44M44 24L39 19M44 24L39 29" stroke="#8fe8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M24 14V4M24 4L19 9M24 4L29 9" stroke="#8fe8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M24 34V44M24 44L19 39M24 44L29 39" stroke="#8fe8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </g>
    </svg>
  `;
  document.body.appendChild(rotationZone);

  const moveArrowsGroup = rotationZone.querySelector('#move-arrows');

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

  // ========== ROTATE-OBJECT ZONE (90 deg turns around Y or X) ==========
  const rotateObjectZone = document.createElement('div');
  rotateObjectZone.id = 'rotate-object-zone';
  rotateObjectZone.setAttribute('aria-label', 'Swipe horizontally or vertically to rotate falling shape');
  rotateObjectZone.innerHTML = `
    <svg viewBox="0 0 48 48" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <path d="M34 10C30.8 7.8 27 6.5 23 6.5C13.6 6.5 6 14.1 6 23.5C6 26.4 6.7 29.1 8 31.5" stroke="#ffb84d" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M8 31.5L8 24M8 31.5L15 29.5" stroke="#ffb84d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M14 38C17.2 40.2 21 41.5 25 41.5C34.4 41.5 42 33.9 42 24.5C42 21.6 41.3 18.9 40 16.5" stroke="#ffb84d" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M40 16.5L40 24M40 16.5L33 18.5" stroke="#ffb84d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>
  `;
  document.body.appendChild(rotateObjectZone);

  const rotateObjectZoneStyle = document.createElement('style');
  rotateObjectZoneStyle.textContent = `
    #rotate-object-zone {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 90px;
      height: 90px;
      z-index: 10;
      cursor: grab;
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
      opacity: 0.5;
      transition: opacity 0.15s ease;
    }
    #rotate-object-zone:hover,
    #rotate-object-zone:active {
      opacity: 0.95;
    }
  `;
  document.head.appendChild(rotateObjectZoneStyle);

  // ========== FALLING-OBJECT DRAG (move zone: swipe to shift the piece) ==========
  function worldToScreen(vec3) {
    const v = vec3.clone().project(camera);
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  const OBJECT_DRAG_LOCK_PX = 12;
  const OBJECT_DRAG_MOVE_PX = 55;

  let objectDrag = null;

  rotationZone.addEventListener('pointerdown', (event) => {
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
    rotationZone.style.cursor = 'grabbing';
    rotationZone.setPointerCapture(event.pointerId);
  });

  rotationZone.addEventListener('pointermove', (event) => {
    if (!objectDrag) return;
    const { obj } = objectDrag;
    if (obj.landed) {
      objectDrag = null;
      rotationZone.style.cursor = 'grab';
      return;
    }

    const deltaX = event.clientX - objectDrag.startX;
    const deltaY = event.clientY - objectDrag.startY;

    if (!objectDrag.axis) {
      if (Math.hypot(deltaX, deltaY) < OBJECT_DRAG_LOCK_PX) return;

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
      objectDrag.applied = true;
    }
  });

  const stopObjectDrag = () => {
    objectDrag = null;
    rotationZone.style.cursor = 'grab';
  };
  rotationZone.addEventListener('pointerup', stopObjectDrag);
  rotationZone.addEventListener('pointercancel', stopObjectDrag);
  rotationZone.addEventListener('pointerleave', stopObjectDrag);

  // ========== ROTATE-OBJECT DRAG (rotate zone: swipe to spin the piece) ==========
  const ROTATE_DRAG_LOCK_PX = 12;
  const ROTATE_DRAG_MOVE_PX = 45;

  let rotateDrag = null;

  rotateObjectZone.addEventListener('pointerdown', (event) => {
    const obj = fallingObjects.find(o => !o.landed);
    if (!obj) return;
    rotateDrag = {
      obj,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      sign: 0,
      applied: false
    };
    rotateObjectZone.style.cursor = 'grabbing';
    rotateObjectZone.setPointerCapture(event.pointerId);
  });

  rotateObjectZone.addEventListener('pointermove', (event) => {
    if (!rotateDrag) return;
    const { obj } = rotateDrag;
    if (obj.landed) {
      rotateDrag = null;
      rotateObjectZone.style.cursor = 'grab';
      return;
    }

    const deltaX = event.clientX - rotateDrag.startX;
    const deltaY = event.clientY - rotateDrag.startY;

    if (!rotateDrag.axis) {
      if (Math.hypot(deltaX, deltaY) < ROTATE_DRAG_LOCK_PX) return;
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        rotateDrag.axis = 'y';
        rotateDrag.sign = deltaX >= 0 ? 1 : -1;
      } else {
        rotateDrag.axis = 'x';
        rotateDrag.sign = deltaY >= 0 ? 1 : -1;
      }
    }

    if (!rotateDrag.applied && Math.hypot(deltaX, deltaY) >= ROTATE_DRAG_MOVE_PX) {
      tryRotateFallingObject(obj, rotateDrag.axis, rotateDrag.sign);
      rotateDrag.applied = true;
    }
  });

  const stopRotateDrag = () => {
    rotateDrag = null;
    rotateObjectZone.style.cursor = 'grab';
  };
  rotateObjectZone.addEventListener('pointerup', stopRotateDrag);
  rotateObjectZone.addEventListener('pointercancel', stopRotateDrag);
  rotateObjectZone.addEventListener('pointerleave', stopRotateDrag);
  rotateObjectZone.style.cursor = 'grab';

  // ========== CUBE ROTATION (swipe anywhere on canvas, 90° snaps) ==========
  const CUBE_ROTATE_LOCK_PX = 12;
  const CUBE_ROTATE_MOVE_PX = 55;

  let cubeDrag = null;

  canvas.addEventListener('pointerdown', (event) => {
    cubeDrag = {
      startX: event.clientX,
      startY: event.clientY,
      applied: false
    };
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!cubeDrag || cubeDrag.applied) return;

    const deltaX = event.clientX - cubeDrag.startX;
    const deltaY = event.clientY - cubeDrag.startY;

    if (Math.hypot(deltaX, deltaY) < CUBE_ROTATE_LOCK_PX) return;

    // Only horizontal swipes rotate the cube (left/right).
    if (Math.abs(deltaX) < Math.abs(deltaY)) return;

    if (Math.abs(deltaX) >= CUBE_ROTATE_MOVE_PX) {
      const dir = deltaX >= 0 ? 1 : -1;
      cubeGroup.rotation.y += dir * (Math.PI / 2);
      cubeDrag.applied = true;
    }
  });

  const stopCubeDrag = () => {
    cubeDrag = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', stopCubeDrag);
  canvas.addEventListener('pointercancel', stopCubeDrag);
  canvas.addEventListener('pointerleave', stopCubeDrag);
  canvas.style.cursor = 'grab';

  function animate() {
    requestAnimationFrame(animate);

    // Keep the move-zone icon's arrows aligned with the actual on-screen
    // column direction, derived the same way the drag handler computes it.
    if (moveArrowsGroup) {
      const obj = fallingObjects.find(o => !o.landed);
      if (obj) {
        const originWorld = obj.group.getWorldPosition(new THREE.Vector3());
        const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(cubeGroup.quaternion);

        const originScreen = worldToScreen(originWorld);
        const xScreen = worldToScreen(originWorld.clone().add(localX));

        const screenAngle = Math.atan2(
          xScreen.y - originScreen.y,
          xScreen.x - originScreen.x
        );
        moveArrowsGroup.style.transform = `rotate(${screenAngle}rad)`;
      }
    }

    for (let idx = 0; idx < fallingObjects.length; idx++) {
      const c = fallingObjects[idx];
      if (c.landed) continue;

      const gridBaseY = computeTargetYFor(c.gridCol, c.gridRow, c.shape, c.shapeProps);
      const worldTargetY = gridBaseY - cubeHalfSize + 0.5;

      c.gridBaseY = gridBaseY;

      if (c.group.position.y > worldTargetY) {
        c.group.position.y -= FALL_SPEED;
      } else {
        c.group.position.y = worldTargetY;
        c.landed = true;

        // Mark exact grid positions occupied by each cube
        c.shape.cubes.forEach(cube => {
          const x = c.gridCol + cube.x - c.shapeProps.minX;
          const z = c.gridRow + cube.z - c.shapeProps.minZ;
          const y = gridBaseY + cube.y - c.shapeProps.minY;
          if (x >= 0 && x < GRID_SIZE && z >= 0 && z < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
            occupancy[x][z][y] = true;
          }
        });

        c.pathLines.forEach(({ line }) => cubeGroup.remove(line));
        fallingObjects = fallingObjects.filter(obj => obj !== c);

        if (spawnedCount < MAX_SHAPES) spawnFallingObject(1, 0);
      }

      updatePathLines(c, worldTargetY);
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

  if (DEBUG) {
    window.__occupancy = occupancy;
    window.__fallingObjects = fallingObjects;
  }
} catch (err) {
  const errMsg = err && err.message ? err.message : String(err);
  setError(errMsg);
                                        }
