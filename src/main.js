import * as THREE from 'three';

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#040816');
scene.fog = new THREE.Fog('#040816', 10, 30);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 5, 12);
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

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(5, 5, 5),
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
  new THREE.EdgesGeometry(new THREE.BoxGeometry(5, 5, 5)),
  new THREE.LineBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.6 })
);
cubeGroup.add(outline);

const secondaryCubeGroup = new THREE.Group();
secondaryCubeGroup.position.set(0, 4, 0);

const secondaryCube = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshStandardMaterial({
    color: 0x8fe8ff,
    emissive: 0x144b7a,
    emissiveIntensity: 0.45,
    roughness: 0.2,
    metalness: 0.3
  })
);
secondaryCubeGroup.add(secondaryCube);

const secondaryOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
);
secondaryCubeGroup.add(secondaryOutline);

cubeGroup.add(secondaryCubeGroup);

const gridMaterial = new THREE.LineBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.18 });
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
const fallSpeed = 0.05;
const landingY = -2.5 + 1; // Bottom of large cube (y=-2.5) plus half height of small cube (h=1)

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
  
  // Animate small cube falling
  if (isFalling && secondaryCubeGroup.position.y > landingY) {
    secondaryCubeGroup.position.y -= fallSpeed;
  } else if (isFalling) {
    isFalling = false;
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
