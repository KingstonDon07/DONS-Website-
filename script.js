import * as THREE from "three";
import { MTLLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/OBJLoader.js";

const stage = document.querySelector(".animation__stage");
const replayButton = document.querySelector(".replay");
const assetPath = new URL("./assets/", import.meta.url).href;
const holdDuration = 550;
const animationDuration = 2650;
const cameraFov = 22;

const pieces = [
  { model: "red-house-1.obj", material: "red-house-1.mtl", object: "Cube" },
  { model: "red-house-2.obj", material: "red-house-2.mtl", object: "Cube.005" },
  { model: "red-house-3.obj", material: "red-house-3.mtl", object: "Cube.002" },
  { model: "red-house-4.obj", material: "red-house-4.mtl", object: "Cube.003" },
  { model: "red-house-5.obj", material: "red-house-5.mtl", object: "Cube.004" }
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(cameraFov, 1, 0.1, 1000);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const loadingManager = new THREE.LoadingManager();
const loadedMaterials = new Set();
const animatedMeshes = [];
let textureLoadFailed = false;
let animationStartTime = null;

function applyTextureFallback() {
  if (!textureLoadFailed) return;

  loadedMaterials.forEach((material) => {
    if (material.map) {
      material.map.dispose();
      material.map = null;
    }

    material.color.set(0xb6424b);
    material.needsUpdate = true;
  });
}

loadingManager.onError = (url) => {
  if (url.toLowerCase().includes("house-design.png")) {
    if (!textureLoadFailed) {
      console.error(`Missing material texture: ${url}. Expected images/house-design.png.`);
    }

    textureLoadFailed = true;
    applyTextureFallback();
    return;
  }

  console.error(`Unable to load 3D asset: ${url}`);
};

function findMesh(root, name) {
  let match;
  root.traverse((child) => {
    if (child.isMesh && child.name === name) match = child;
  });

  if (!match) {
    throw new Error(`The OBJ file does not contain the expected object "${name}".`);
  }

  return match;
}

function verifyPositionMatch(sourceMesh, referenceMesh, description) {
  const source = sourceMesh.geometry.getAttribute("position").array;
  const reference = referenceMesh.geometry.getAttribute("position").array;

  if (source.length !== reference.length) {
    throw new Error(`${description} does not match the reference model topology.`);
  }

  for (let index = 0; index < source.length; index += 1) {
    if (Math.abs(source[index] - reference[index]) > 1e-5) {
      throw new Error(`${description} does not match the reference model positions.`);
    }
  }
}

function convertMaterialsToBasic(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const basicMaterials = materials.map((material) => {
      const basicMaterial = new THREE.MeshBasicMaterial({
        color: material.color.clone(),
        map: material.map,
        alphaMap: material.alphaMap,
        opacity: material.opacity,
        transparent: material.transparent,
        alphaTest: material.alphaTest,
        depthWrite: material.depthWrite,
        side: material.side
      });

      loadedMaterials.add(basicMaterial);
      return basicMaterial;
    });

    child.material = Array.isArray(child.material) ? basicMaterials : basicMaterials[0];
  });

  applyTextureFallback();
}

async function loadPiece(piece) {
  const root = await loadModel(piece.model, piece.material);
  const mesh = findMesh(root, piece.object);
  mesh.frustumCulled = false;
  return mesh;
}

async function loadModel(model, material) {
  const materialCreator = await new MTLLoader(loadingManager)
    .setPath(assetPath)
    .loadAsync(material);
  materialCreator.preload();

  const root = await new OBJLoader(loadingManager)
    .setMaterials(materialCreator)
    .setPath(assetPath)
    .loadAsync(model);
  convertMaterialsToBasic(root);
  return root;
}

function setProgress(progress) {
  animatedMeshes.forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const start = mesh.userData.startPositions;
    const end = mesh.userData.endPositions;

    for (let index = 0; index < position.array.length; index += 1) {
      position.array[index] = start[index] + (end[index] - start[index]) * progress;
    }

    position.needsUpdate = true;
  });
}

function playAnimation() {
  setProgress(0);
  animationStartTime = performance.now() + holdDuration;
}

function resize() {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const aspect = width / height;
  const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(cameraFov / 2));
  const cameraDistance = Math.max(24, 6.7 / (2 * halfFovTangent * aspect));

  renderer.setSize(width, height, false);
  camera.aspect = aspect;
  camera.position.set(0, -cameraDistance, 0);
  camera.lookAt(0, 0, 0.15);
  camera.updateProjectionMatrix();
}

async function initialize() {
  const [firstState, finalState] = await Promise.all([
    loadModel("first-state-3d.obj", "first-state-3d.mtl"),
    loadModel("final-state-3d.obj", "final-state-3d.mtl")
  ]);
  const loadedPieces = await Promise.all(pieces.map(loadPiece));

  pieces.forEach((piece, index) => {
    const mesh = loadedPieces[index];
    const startPosition = mesh.geometry.getAttribute("position");
    const firstStateMesh = findMesh(firstState, piece.object);
    const finalStateMesh = findMesh(finalState, piece.object);
    const finalPosition = finalStateMesh.geometry.getAttribute("position");

    verifyPositionMatch(mesh, firstStateMesh, piece.model);

    if (startPosition.array.length !== finalPosition.array.length) {
      throw new Error(`${piece.model} and final-state-3d.obj have incompatible geometry.`);
    }

    mesh.userData.startPositions = startPosition.array.slice();
    mesh.userData.endPositions = finalPosition.array.slice();
    scene.add(mesh);
    animatedMeshes.push(mesh);
  });

  setProgress(0);
  replayButton.disabled = false;
  playAnimation();
}

window.addEventListener("resize", resize);
replayButton.addEventListener("click", playAnimation);
resize();

renderer.setAnimationLoop((time) => {
  if (animationStartTime !== null && time >= animationStartTime) {
    const elapsed = Math.min((time - animationStartTime) / animationDuration, 1);
    const eased = 1 - (1 - elapsed) ** 3;
    setProgress(eased);

    if (elapsed === 1) animationStartTime = null;
  }

  renderer.render(scene, camera);
});

initialize();
