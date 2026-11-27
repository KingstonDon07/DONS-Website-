import * as THREE from "three";
import { MTLLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/OBJLoader.js";

const stage = document.querySelector(".animation__stage");
const replayButton = document.querySelector(".replay");
const yearReveal = document.querySelector(".year-reveal");
const grainOverlay = document.querySelector(".film-grain");
const dateUnlockForm = document.querySelector(".date-unlock");
const dateUnlockInput = document.querySelector("#unlock-date");
const dateUnlockStatus = document.querySelector(".date-unlock__status");
const assetPath = new URL("./assets/", import.meta.url).href;
const holdDuration = 550;
const animationDuration = 2650;
const restitution = 0.58;
const returnDelay = 15000;
const returnDuration = 900;
const cameraFov = 22;
const unlockDate = "1962";

const pieces = [
  { model: "red-house-1.obj", material: "red-house-1.mtl", object: "Cube" },
  { model: "red-house-2.obj", material: "red-house-2.mtl", object: "Cube.005" },
  { model: "red-house-3.obj", material: "red-house-3.mtl", object: "Cube.002" },
  { model: "red-house-4.obj", material: "red-house-4.mtl", object: "Cube.003" },
  { model: "red-house-5.obj", material: "red-house-5.mtl", object: "Cube.004" }
];

const scene = new THREE.Scene();
scene.background = null;

const modelRoot = new THREE.Group();
modelRoot.scale.z = -1;
scene.add(modelRoot);

const camera = new THREE.PerspectiveCamera(cameraFov, 1, 0.1, 1000);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const loadingManager = new THREE.LoadingManager();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const loadedMaterials = new Set();
const animatedMeshes = [];
let textureLoadFailed = false;
let animationStartTime = null;
let interactionEnabled = false;
let draggedMesh = null;
let draggedPointerId = null;
let lastPointer = null;
let pointerDownPosition = null;
let grainClickCandidate = false;
let grainAnimation = null;
let returnAt = null;
let returnAnimation = null;
let lastPhysicsTime = null;

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

function moveOnScreenPlane(mesh, deltaX, deltaY) {
  const worldCenter = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  const targetCenter = worldCenter.clone().project(camera);
  targetCenter.x += (2 * deltaX) / renderer.domElement.clientWidth;
  targetCenter.y -= (2 * deltaY) / renderer.domElement.clientHeight;
  const worldDelta = targetCenter.unproject(camera).sub(worldCenter);
  const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
  const localStart = modelRoot.worldToLocal(worldPosition.clone());
  const localEnd = modelRoot.worldToLocal(worldPosition.add(worldDelta));

  mesh.position.add(localEnd.sub(localStart));
  modelRoot.updateMatrixWorld(true);
}

function getScreenBounds(mesh) {
  modelRoot.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(mesh);
  const corners = [
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z)
  ];
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  const screenBounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };

  corners.forEach((corner) => {
    corner.project(camera);
    const x = (corner.x + 1) * width / 2;
    const y = (1 - corner.y) * height / 2;
    screenBounds.left = Math.min(screenBounds.left, x);
    screenBounds.right = Math.max(screenBounds.right, x);
    screenBounds.top = Math.min(screenBounds.top, y);
    screenBounds.bottom = Math.max(screenBounds.bottom, y);
  });

  return screenBounds;
}

function constrainToViewport(mesh, bounce) {
  const bounds = getScreenBounds(mesh);
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  const velocity = mesh.userData.physics;
  const hitLeft = bounds.left < 0;
  const hitRight = bounds.right > width;
  const hitTop = bounds.top < 0;
  const hitBottom = bounds.bottom > height;
  let deltaX = 0;
  let deltaY = 0;

  if (bounds.right - bounds.left >= width) {
    deltaX = width / 2 - (bounds.left + bounds.right) / 2;
  } else if (hitLeft) {
    deltaX = -bounds.left;
  } else if (hitRight) {
    deltaX = width - bounds.right;
  }

  if (bounds.bottom - bounds.top >= height) {
    deltaY = height / 2 - (bounds.top + bounds.bottom) / 2;
  } else if (hitTop) {
    deltaY = -bounds.top;
  } else if (hitBottom) {
    deltaY = height - bounds.bottom;
  }

  if (deltaX || deltaY) moveOnScreenPlane(mesh, deltaX, deltaY);

  if (bounce) {
    if (hitLeft && hitRight) {
      velocity.x = 0;
    } else if (hitLeft && velocity.x < 0) {
      velocity.x = -velocity.x * restitution;
    } else if (hitRight && velocity.x > 0) {
      velocity.x = -velocity.x * restitution;
    }

    if (hitTop && hitBottom) {
      velocity.y = 0;
    } else if (hitTop && velocity.y < 0) {
      velocity.y = -velocity.y * restitution;
    } else if (hitBottom && velocity.y > 0) {
      velocity.y = -velocity.y * restitution;
      if (Math.abs(velocity.y) < 24 && Math.abs(velocity.x) < 12) {
        velocity.y = 0;
        velocity.x = 0;
        velocity.active = false;
      }
    }
  }
}

function resolvePieceCollisions() {
  for (let firstIndex = 0; firstIndex < animatedMeshes.length; firstIndex += 1) {
    const first = animatedMeshes[firstIndex];
    const firstPhysics = first.userData.physics;
    const firstIsDragged = first === draggedMesh;

    for (let secondIndex = firstIndex + 1; secondIndex < animatedMeshes.length; secondIndex += 1) {
      const second = animatedMeshes[secondIndex];
      const secondPhysics = second.userData.physics;
      const secondIsDragged = second === draggedMesh;
      if (
        !firstPhysics.active &&
        !firstIsDragged &&
        !secondPhysics.active &&
        !secondIsDragged
      ) continue;

      const firstBounds = getScreenBounds(first);
      const secondBounds = getScreenBounds(second);
      const overlapX = Math.min(firstBounds.right, secondBounds.right) - Math.max(firstBounds.left, secondBounds.left);
      const overlapY = Math.min(firstBounds.bottom, secondBounds.bottom) - Math.max(firstBounds.top, secondBounds.top);
      if (overlapX <= 0 || overlapY <= 0) continue;

      const horizontal = overlapX <= overlapY;
      const firstCenter = horizontal
        ? (firstBounds.left + firstBounds.right) / 2
        : (firstBounds.top + firstBounds.bottom) / 2;
      const secondCenter = horizontal
        ? (secondBounds.left + secondBounds.right) / 2
        : (secondBounds.top + secondBounds.bottom) / 2;
      const normal = secondCenter >= firstCenter ? 1 : -1;
      const normalX = horizontal ? normal : 0;
      const normalY = horizontal ? 0 : normal;
      const inverseMassFirst = firstIsDragged ? 0 : 1;
      const inverseMassSecond = secondIsDragged ? 0 : 1;
      const inverseMassTotal = inverseMassFirst + inverseMassSecond;
      const penetration = horizontal ? overlapX : overlapY;

      if (inverseMassFirst) {
        moveOnScreenPlane(
          first,
          -normalX * penetration * inverseMassFirst / inverseMassTotal,
          -normalY * penetration * inverseMassFirst / inverseMassTotal
        );
      }

      if (inverseMassSecond) {
        moveOnScreenPlane(
          second,
          normalX * penetration * inverseMassSecond / inverseMassTotal,
          normalY * penetration * inverseMassSecond / inverseMassTotal
        );
      }

      const relativeVelocity =
        (secondPhysics.x - firstPhysics.x) * normalX +
        (secondPhysics.y - firstPhysics.y) * normalY;

      if (relativeVelocity < 0) {
        const impulse = -(1 + restitution) * relativeVelocity / inverseMassTotal;

        if (inverseMassFirst) {
          firstPhysics.x -= impulse * inverseMassFirst * normalX;
          firstPhysics.y -= impulse * inverseMassFirst * normalY;
          firstPhysics.active = true;
        }

        if (inverseMassSecond) {
          secondPhysics.x += impulse * inverseMassSecond * normalX;
          secondPhysics.y += impulse * inverseMassSecond * normalY;
          secondPhysics.active = true;
        }
      }

      if (inverseMassFirst) constrainToViewport(first, true);
      if (inverseMassSecond) constrainToViewport(second, true);
    }
  }
}

function updatePhysics(time) {
  const elapsed = lastPhysicsTime === null ? 0 : Math.min((time - lastPhysicsTime) / 1000, 0.05);
  lastPhysicsTime = time;

  if (!elapsed) return;

  animatedMeshes.forEach((mesh) => {
    const velocity = mesh.userData.physics;
    if (!velocity.active || mesh === draggedMesh) return;

    velocity.x *= Math.exp(-0.2 * elapsed);
    velocity.y *= Math.exp(-0.2 * elapsed);
    moveOnScreenPlane(mesh, velocity.x * elapsed, velocity.y * elapsed);
    constrainToViewport(mesh, true);

    if (Math.abs(velocity.x) < 6 && Math.abs(velocity.y) < 6) {
      velocity.x = 0;
      velocity.y = 0;
      velocity.active = false;
    }
  });

  resolvePieceCollisions();
}

function startReturn(time) {
  returnAt = null;
  returnAnimation = {
    startTime: time,
    startPositions: animatedMeshes.map((mesh) => mesh.position.clone())
  };

  animatedMeshes.forEach((mesh) => {
    mesh.userData.physics.x = 0;
    mesh.userData.physics.y = 0;
    mesh.userData.physics.active = false;
  });
}

function updateReturn(time) {
  const elapsed = Math.min((time - returnAnimation.startTime) / returnDuration, 1);
  const eased = 1 - (1 - elapsed) ** 2;

  animatedMeshes.forEach((mesh, index) => {
    mesh.position.copy(returnAnimation.startPositions[index]).multiplyScalar(1 - eased);
  });

  if (elapsed === 1) returnAnimation = null;
}

function pointerToNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
}

function isCenterHitOnSecondPiece(event) {
  const secondPiece = animatedMeshes[1];
  if (!interactionEnabled || !secondPiece) return false;

  const bounds = getScreenBounds(secondPiece);
  const rect = renderer.domElement.getBoundingClientRect();
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const inCenter =
    Math.abs(localX - centerX) <= (bounds.right - bounds.left) * 0.25 &&
    Math.abs(localY - centerY) <= (bounds.bottom - bounds.top) * 0.25;

  if (!inCenter) return false;

  pointerToNdc(event);
  modelRoot.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(secondPiece, false).length > 0;
}

function updateYearReveal(event) {
  const visible = isCenterHitOnSecondPiece(event);
  yearReveal.classList.toggle("is-visible", visible);

  if (!draggedMesh) {
    renderer.domElement.style.cursor = visible ? "pointer" : interactionEnabled ? "grab" : "default";
  }
}

function triggerGrain() {
  if (grainAnimation) grainAnimation.cancel();

  grainAnimation = grainOverlay.animate(
    [
      { opacity: 0, transform: "translate(0, 0)" },
      { opacity: 0.2, transform: "translate(-1px, 1px)", offset: 0.2 },
      { opacity: 0.12, transform: "translate(1px, -1px)", offset: 0.45 },
      { opacity: 0.2, transform: "translate(-1px, -1px)", offset: 0.7 },
      { opacity: 0, transform: "translate(0, 0)" }
    ],
    { duration: 720, easing: "steps(2, end)" }
  );
  grainAnimation.onfinish = () => {
    grainAnimation = null;
  };
}

function onPointerDown(event) {
  if (!interactionEnabled || event.button !== 0) return;

  pointerToNdc(event);
  modelRoot.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  const [intersection] = raycaster.intersectObjects(animatedMeshes, false);
  if (!intersection) return;

  event.preventDefault();
  draggedMesh = intersection.object;
  draggedPointerId = event.pointerId;
  pointerDownPosition = { x: event.clientX, y: event.clientY };
  grainClickCandidate = draggedMesh === animatedMeshes[1] && isCenterHitOnSecondPiece(event);
  lastPointer = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  returnAt = null;
  returnAnimation = null;
  draggedMesh.userData.physics.x = 0;
  draggedMesh.userData.physics.y = 0;
  draggedMesh.userData.physics.active = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  renderer.domElement.style.cursor = "grabbing";
}

function onPointerMove(event) {
  if (!draggedMesh || event.pointerId !== draggedPointerId) {
    updateYearReveal(event);
    return;
  }

  const deltaX = event.clientX - lastPointer.x;
  const deltaY = event.clientY - lastPointer.y;
  const elapsed = Math.max((event.timeStamp - lastPointer.time) / 1000, 1 / 240);
  const velocity = draggedMesh.userData.physics;

  velocity.x = THREE.MathUtils.clamp((deltaX / elapsed) * 0.75 + velocity.x * 0.25, -1600, 1600);
  velocity.y = THREE.MathUtils.clamp((deltaY / elapsed) * 0.75 + velocity.y * 0.25, -1600, 1600);
  moveOnScreenPlane(draggedMesh, deltaX, deltaY);
  constrainToViewport(draggedMesh, false);
  resolvePieceCollisions();

  lastPointer = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  updateYearReveal(event);
}

function onPointerUp(event) {
  if (!draggedMesh || event.pointerId !== draggedPointerId) return;

  const wasClick =
    pointerDownPosition &&
    Math.hypot(
      event.clientX - pointerDownPosition.x,
      event.clientY - pointerDownPosition.y
    ) <= 6;

  if (event.type === "pointerup" && wasClick && grainClickCandidate) triggerGrain();

  draggedMesh.userData.physics.active = true;
  draggedMesh = null;
  draggedPointerId = null;
  lastPointer = null;
  pointerDownPosition = null;
  grainClickCandidate = false;
  returnAt = performance.now() + returnDelay;
  renderer.domElement.style.cursor = "grab";
  updateYearReveal(event);
}

function playAnimation() {
  interactionEnabled = false;
  draggedMesh = null;
  draggedPointerId = null;
  lastPointer = null;
  pointerDownPosition = null;
  grainClickCandidate = false;
  returnAt = null;
  returnAnimation = null;
  yearReveal.classList.remove("is-visible");
  if (grainAnimation) {
    grainAnimation.cancel();
    grainAnimation = null;
  }
  animatedMeshes.forEach((mesh) => {
    mesh.position.set(0, 0, 0);
    mesh.userData.physics.x = 0;
    mesh.userData.physics.y = 0;
    mesh.userData.physics.active = false;
  });
  renderer.domElement.style.cursor = "default";
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
    mesh.userData.physics = { x: 0, y: 0, active: false };
    modelRoot.add(mesh);
    animatedMeshes.push(mesh);
  });

  setProgress(0);
  replayButton.disabled = false;
  playAnimation();
}

dateUnlockForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (dateUnlockInput.value.trim() !== unlockDate) {
    dateUnlockStatus.textContent = "Date not recognized.";
    dateUnlockInput.setAttribute("aria-invalid", "true");
    dateUnlockInput.focus();
    return;
  }

  sessionStorage.setItem("red-house-unlocked", "true");
  window.location.href = new URL("./unlocked.html", import.meta.url).href;
});

dateUnlockInput.addEventListener("input", () => {
  dateUnlockStatus.textContent = "";
  dateUnlockInput.removeAttribute("aria-invalid");
});

window.addEventListener("resize", resize);
replayButton.addEventListener("click", playAnimation);
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerUp);
renderer.domElement.addEventListener("pointerleave", () => {
  if (draggedMesh) return;
  yearReveal.classList.remove("is-visible");
  renderer.domElement.style.cursor = interactionEnabled ? "grab" : "default";
});
resize();

renderer.setAnimationLoop((time) => {
  if (animationStartTime !== null && time >= animationStartTime) {
    const elapsed = Math.min((time - animationStartTime) / animationDuration, 1);
    const eased = 1 - (1 - elapsed) ** 3;
    setProgress(eased);

    if (elapsed === 1) {
      animationStartTime = null;
      animatedMeshes.forEach((mesh) => {
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
      });
      interactionEnabled = true;
      lastPhysicsTime = time;
      renderer.domElement.style.cursor = "grab";
    }
  }

  if (interactionEnabled) {
    if (returnAnimation) {
      updateReturn(time);
    } else {
      if (returnAt !== null && time >= returnAt && !draggedMesh) startReturn(time);
      if (returnAnimation) updateReturn(time);
      else updatePhysics(time);
    }
  }

  renderer.render(scene, camera);
});

initialize();
