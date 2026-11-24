import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const mount = document.querySelector("#scene");
const status = document.querySelector("#status");
const green = 0x82c85c;
const scene = new THREE.Scene();
scene.background = new THREE.Color(green);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
let cameraDistance = 11.6;
const cameraTarget = new THREE.Vector3(0, 0.15, 0);
const desiredCameraPosition = new THREE.Vector3();
const currentPointer = new THREE.Vector2();
const targetPointer = new THREE.Vector2();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const stage = new THREE.Group();
scene.add(stage);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(green);
mount.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xf5f2e9, 0x323d2e, 1.7));

const keyLight = new THREE.DirectionalLight(0xfff4df, 3.2);
keyLight.position.set(-4, 6, 8);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xdce9ff, 1.5);
fillLight.position.set(5, 2, 4);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 2.2);
rimLight.position.set(1, 5, -6);
scene.add(rimLight);

const fieldMaterial = new THREE.MeshBasicMaterial({ color: green });
const fieldPlane = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), fieldMaterial);
fieldPlane.position.z = -4.8;
scene.add(fieldPlane);

function resize() {
  const width = mount.clientWidth;
  const height = mount.clientHeight;
  const portrait = width <= 700;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  cameraDistance = portrait ? 22.5 : 11.6;
  stage.position.y = portrait ? -0.65 : 0;
  document.documentElement.classList.toggle("portrait-field", portrait);
  if (paper) updatePaperGeometry(portrait);
}

function setPointerPosition(event) {
  targetPointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  targetPointer.y = (event.clientY / window.innerHeight) * 2 - 1;
}

window.addEventListener("resize", resize);
window.addEventListener("pointermove", setPointerPosition, { passive: true });
window.addEventListener("pointerleave", () => targetPointer.set(0, 0), { passive: true });

let paper;
let paperTexture;
const paperWidth = 10.4;
const paperHeight = paperWidth * (700 / 1515);

function updatePaperGeometry(portrait) {
  paper.geometry.dispose();
  paper.geometry = portrait
    ? new THREE.PlaneGeometry(paperHeight, paperWidth)
    : new THREE.PlaneGeometry(paperWidth, paperHeight);
  paperTexture.rotation = portrait ? Math.PI / 2 : 0;
  paperTexture.center.set(0.5, 0.5);
  paperTexture.updateMatrix();
}

resize();

async function loadSceneAssets() {
  const textureLoader = new THREE.TextureLoader();
  paperTexture = await new Promise((resolve, reject) => {
    textureLoader.load("./assets/Paper-tear-transparent.png", resolve, undefined, reject);
  });
  paperTexture.colorSpace = THREE.SRGBColorSpace;
  paperTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  paper = new THREE.Mesh(
    new THREE.PlaneGeometry(paperWidth, paperHeight),
    new THREE.MeshBasicMaterial({
      map: paperTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  paper.position.z = 0;
  stage.add(paper);
  updatePaperGeometry(window.innerWidth <= 700);

  const horse = await new Promise((resolve, reject) => {
    new OBJLoader().load("./assets/horse.obj", resolve, undefined, reject);
  });

  const bounds = new THREE.Box3().setFromObject(horse);
  if (bounds.isEmpty()) {
    throw new Error("The horse model does not contain any geometry.");
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 3.35 / size.y;

  horse.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  horse.scale.setScalar(scale);
  horse.traverse((part) => {
    if (!part.isMesh) return;
    part.material = new THREE.MeshStandardMaterial({
      color: 0x191c1a,
      roughness: 0.44,
      metalness: 0.18
    });
  });
  stage.add(horse);
  status.textContent = "Move your cursor to explore";
}

function animate() {
  requestAnimationFrame(animate);

  const easing = reducedMotion ? 1 : 0.055;
  currentPointer.lerp(targetPointer, easing);
  const yaw = currentPointer.x * 0.48;
  const pitch = currentPointer.y * 0.2;
  desiredCameraPosition.set(
    Math.sin(yaw) * cameraDistance,
    0.45 - pitch * 2.4,
    Math.cos(yaw) * cameraDistance
  );
  camera.position.lerp(desiredCameraPosition, easing);
  camera.lookAt(cameraTarget);
  renderer.render(scene, camera);
}

loadSceneAssets().catch((error) => {
  console.error("Unable to load the 3D paper field.", error);
  status.textContent = "The scene could not be loaded";
});

animate();
