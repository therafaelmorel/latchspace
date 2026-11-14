import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const _sunLocal = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _from = new THREE.Vector3();

function canvasTex(draw, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function crinkle() {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.cos(x * 0.85) * 0.85 + Math.cos(x * 2.2 + y * 0.4) * 0.35;
      const dy = Math.sin(y * 0.7) * 0.7 + Math.sin(y * 1.8 + x * 0.3) * 0.3;
      const nx = -dx;
      const ny = -dy;
      const nz = 2.4;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = (nx / len * 0.5 + 0.5) * 255;
      data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function mark(parent, anchors, name, x, y, z) {
  const obj = new THREE.Object3D();
  obj.name = name;
  obj.position.set(x, y, z);
  parent.add(obj);
  anchors[name] = obj;
  return obj;
}

function tune(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    list.forEach((mat) => {
      if (mat.metalness != null) mat.metalness = Math.min(0.8, mat.metalness);
      if (mat.roughness != null) mat.roughness = Math.max(0.36, mat.roughness);
      mat.envMapIntensity = 0.35;
    });
  });
}

function center(object) {
  const box = new THREE.Box3().setFromObject(object);
  const mid = box.getCenter(new THREE.Vector3());
  object.position.sub(mid);
  box.setFromObject(object);
  return box.getSize(new THREE.Vector3());
}

export function createSpacecraft() {
  const group = new THREE.Group();
  group.name = "spacecraft";
  group.scale.setScalar(0.118);
  const anchors = {};
  const wings = [];
  let gimbal = null;
  let plumeMat = null;
  let deploy = 0.35;
  let built = false;

  const carbon = new THREE.MeshStandardMaterial({ color: 0x161a1e, metalness: 0.64, roughness: 0.4 });
  const titanium = new THREE.MeshStandardMaterial({ color: 0xa1a7ac, metalness: 0.9, roughness: 0.26 });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd49a2a,
    metalness: 0.88,
    roughness: 0.34,
    normalMap: crinkle(),
  });
  const sapphire = new THREE.MeshStandardMaterial({
    color: 0x071016,
    metalness: 1,
    roughness: 0.08,
    emissive: 0x143848,
    emissiveIntensity: 0.7,
  });
  const solarMap = canvasTex((ctx, w, h) => {
    ctx.fillStyle = "#0c1422";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(196, 168, 110, 0.55)";
    ctx.lineWidth = 1;
    for (let x = 6; x < w; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, h - 2);
      ctx.stroke();
    }
    for (let y = 6; y < h; y += 14) {
      ctx.beginPath();
      ctx.moveTo(2, y);
      ctx.lineTo(w - 2, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#b87333";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();
  }, 512, 256);
  const solarMat = new THREE.MeshStandardMaterial({
    map: solarMap,
    color: 0x9eb0c8,
    metalness: 0.45,
    roughness: 0.42,
  });
  const arrayMap = canvasTex((ctx, w, h) => {
    ctx.fillStyle = "#12161c";
    ctx.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 16) {
      for (let x = 8; x < w; x += 16) {
        ctx.fillStyle = (x + y) % 32 === 0 ? "#d4b483" : "#8d97a3";
        ctx.fillRect(x, y, 7, 7);
      }
    }
  }, 256, 256);
  const arrayMat = new THREE.MeshStandardMaterial({
    map: arrayMap,
    color: 0xc5ccd4,
    metalness: 0.72,
    roughness: 0.38,
  });

  function assemble(bus, pod) {
    const busSize = center(bus);
    const podSize = center(pod);
    tune(bus);
    tune(pod);
    group.add(bus);

    const hx = busSize.x * 0.5;
    const hy = busSize.y * 0.5;
    const hz = busSize.z * 0.5;

    const bore = new THREE.Group();
    group.add(bore);
    const objective = new THREE.MeshPhysicalMaterial({
      color: 0x0b1424,
      metalness: 0.22,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      reflectivity: 0.72,
      ior: 1.72,
      emissive: 0x142448,
      emissiveIntensity: 0.22,
    });
    const steps = [
      { r0: 0.2, r1: 0.175, z: 0.72, len: 0.1 },
      { r0: 0.155, r1: 0.132, z: 0.52, len: 0.1 },
      { r0: 0.112, r1: 0.096, z: 0.32, len: 0.11 },
    ];
    steps.forEach((step) => {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(step.r0, step.r1, step.len, 40, 1, true), carbon);
      tube.rotation.x = Math.PI / 2;
      tube.position.z = hz * step.z;
      bore.add(tube);
    });
    const mirror = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 40),
      new THREE.MeshStandardMaterial({ color: 0x07090c, metalness: 1, roughness: 0.16, emissive: 0x0c1820, emissiveIntensity: 0.25 }),
    );
    mirror.position.z = hz * 0.2;
    bore.add(mirror);
    const lensR = Math.min(0.15, hz * 0.32);
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(lensR, 48, 24, 0, Math.PI * 2, 0, 0.72),
      objective,
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = hz * 0.7;
    bore.add(lens);
    for (let i = 0; i < 3; i += 1) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(lensR * 2.1, 0.006, 0.006), new THREE.MeshStandardMaterial({
        color: 0x8d969e,
        metalness: 0.7,
        roughness: 0.32,
      }));
      vane.position.z = hz * 0.86;
      vane.rotation.z = (i / 3) * Math.PI;
      bore.add(vane);
    }
    mark(bore, anchors, "optics", 0, 0, hz * 0.78);

    gimbal = new THREE.Group();
    gimbal.add(pod);
    group.add(gimbal);
    const barrel = findNozzle(pod);
    const dir = barrel.dir.clone().normalize();
    gimbal.quaternion.setFromUnitVectors(dir, new THREE.Vector3(1, 0, 0));
    const scalar = group.scale.x || 1;
    group.scale.setScalar(1);
    group.updateWorldMatrix(true, true);
    const fitted = new THREE.Box3().setFromObject(gimbal);
    group.scale.setScalar(scalar);
    const mid = fitted.getCenter(new THREE.Vector3());
    gimbal.position.set((hx + 0.42) - fitted.min.x, -hy * 0.36 - mid.y, -hz * 0.42 - mid.z);
    seatEmitter(pod, barrel, objective);
    mark(pod, anchors, "comms", barrel.center.x, barrel.center.y, barrel.center.z);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.15, 0.03, hz * 1.35), arrayMat);
    deck.position.set(-hx * 0.05, -hy - 0.02, 0);
    group.add(deck);
    mark(deck, anchors, "array", 0, -0.02, 0);

    const mli = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.15, 0.03, hz * 1.2), gold);
    mli.position.set(0, hy + 0.015, -hz * 0.05);
    group.add(mli);
    const mli2 = new THREE.Mesh(new THREE.BoxGeometry(hx * 0.7, hy * 0.45, 0.02), gold);
    mli2.position.set(hx * 0.15, hy * 0.35, hz * 0.15);
    mli2.rotation.x = 0.4;
    group.add(mli2);
    mark(mli, anchors, "mli", 0, 0.04, 0);

    for (let i = 0; i < 7; i += 1) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.018, hy * 0.16, hz * 0.7), new THREE.MeshStandardMaterial({
        color: 0x2c3338,
        metalness: 0.75,
        roughness: 0.38,
      }));
      fin.position.set(-hx - 0.02, (i - 3) * hy * 0.13, 0.02);
      group.add(fin);
      if (i === 3) mark(fin, anchors, "radiator", 0, 0, 0);
    }

    function makeWing(sign) {
      const pivot = new THREE.Group();
      pivot.position.set(sign * (hx + 0.06), 0.02, 0);
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 16), titanium);
      hinge.rotation.x = Math.PI / 2;
      pivot.add(hinge);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.04), carbon);
      boom.position.x = sign * 0.2;
      pivot.add(boom);
      for (let i = 0; i < 3; i += 1) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.78, 0.016), solarMat);
        panel.position.set(sign * (0.52 + i * 0.62), 0, 0);
        pivot.add(panel);
        if (i < 2) {
          const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12), titanium);
          joint.rotation.x = Math.PI / 2;
          joint.position.set(sign * (0.8 + i * 0.62), 0, 0);
          pivot.add(joint);
        }
        if (sign > 0 && i === 1) mark(panel, anchors, "solar", 0, 0.04, 0);
      }
      group.add(pivot);
      wings.push({ pivot, sign });
    }
    makeWing(1);
    makeWing(-1);

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.24, 24, 1, true), titanium);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -hz - 0.14;
    group.add(nozzle);
    plumeMat = new THREE.MeshBasicMaterial({
      color: 0x7eb6ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 20, 1, true), plumeMat);
    plume.rotation.x = -Math.PI / 2;
    plume.position.z = -hz - 0.38;
    group.add(plume);
    mark(nozzle, anchors, "thruster", 0, 0, -0.12);

    function tracker(x, z, tilt) {
      const rig = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.18, 16, 1, true), carbon);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), sapphire);
      glass.position.y = 0.09;
      glass.rotation.x = -Math.PI / 2;
      rig.add(tube, glass);
      rig.position.set(x, hy + 0.04, z);
      rig.rotation.x = tilt;
      rig.rotation.z = x > 0 ? -0.35 : 0.35;
      group.add(rig);
      return rig;
    }
    tracker(hx * 0.35, -hz * 0.15, 0.5);
    const trackerB = tracker(-hx * 0.28, hz * 0.1, 0.35);
    mark(trackerB, anchors, "tracker", 0, 0.12, 0);

    built = true;
  }

  let resolveReady = null;
  let rejectReady = null;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let started = false;
  function start() {
    if (started) return;
    started = true;
    (async () => {
      try {
        await MeshoptDecoder.ready;
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const [busGltf, podGltf] = await Promise.all([
          loader.loadAsync("/models/satellite_bus.glb"),
          loader.loadAsync("/models/satellite_comms_pod.glb"),
        ]);
        assemble(busGltf.scene, podGltf.scene);
        resolveReady();
      } catch (err) {
        rejectReady(err);
      }
    })();
  }

  function update(dt, state) {
    if (!built) return;
    const reduced = state.reduced;
    const goal = 1;
    deploy = reduced ? 1 : deploy + (goal - deploy) * (1 - Math.exp(-1.4 * dt));
    _qInv.copy(group.quaternion).invert();
    _sunLocal.copy(state.sun).applyQuaternion(_qInv);
    const track = reduced ? 0 : Math.max(-0.12, Math.min(0.12, Math.atan2(_sunLocal.y, Math.abs(_sunLocal.x) + 0.2) * 0.25));
    wings.forEach(({ pivot, sign }) => {
      const folded = 1.15 * (1 - deploy);
      pivot.rotation.z = sign * (folded + track * deploy);
    });
    if (gimbal && state.target) {
      gimbal.getWorldPosition(_from);
      _aim.copy(state.target).sub(_from);
      const parentQ = gimbal.parent.getWorldQuaternion(_qInv);
      _aim.applyQuaternion(parentQ.invert());
      const yaw = Math.atan2(_aim.x, _aim.z);
      const pitch = Math.atan2(-_aim.y, Math.hypot(_aim.x, _aim.z));
      const limit = state.mode === "nadir" ? 0.45 : 0.12;
      const ty = Math.max(-limit, Math.min(limit, yaw));
      const tx = Math.max(-limit, Math.min(limit, pitch));
      if (reduced) {
        gimbal.rotation.y = Math.PI / 2 + ty;
        gimbal.rotation.x = tx;
      } else {
        gimbal.rotation.y += (Math.PI / 2 + ty - gimbal.rotation.y) * (1 - Math.exp(-3 * dt));
        gimbal.rotation.x += (tx - gimbal.rotation.x) * (1 - Math.exp(-3 * dt));
      }
    }
    if (plumeMat) {
      const glow = state.mode === "tour" && state.tour === "propulsion" ? 0.75 : 0.38;
      plumeMat.opacity = reduced ? glow : glow + Math.sin(state.now * 0.004) * 0.08;
    }
  }

  return { group, anchors, update, ready, start };
}

function findNozzle(object) {
  object.updateWorldMatrix(true, true);
  const samples = [];
  const v = new THREE.Vector3();
  object.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry) return;
    const attr = mesh.geometry.getAttribute("position");
    if (!attr) return;
    const step = Math.max(1, Math.floor(attr.count / 9000));
    for (let i = 0; i < attr.count; i += step) {
      v.fromBufferAttribute(attr, i);
      mesh.localToWorld(v);
      object.worldToLocal(v);
      samples.push(v.x, v.y, v.z);
    }
  });
  const axes = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ];
  let best = null;
  axes.forEach((axis) => {
    let max = -Infinity;
    for (let i = 0; i < samples.length; i += 3) {
      const d = samples[i] * axis[0] + samples[i + 1] * axis[1] + samples[i + 2] * axis[2];
      if (d > max) max = d;
    }
    const cluster = [];
    for (let i = 0; i < samples.length; i += 3) {
      const d = samples[i] * axis[0] + samples[i + 1] * axis[1] + samples[i + 2] * axis[2];
      if (d > max - 0.04) cluster.push(i);
    }
    if (cluster.length < 6) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    cluster.forEach((i) => {
      cx += samples[i];
      cy += samples[i + 1];
      cz += samples[i + 2];
    });
    cx /= cluster.length;
    cy /= cluster.length;
    cz /= cluster.length;
    let maxR = 0;
    cluster.forEach((i) => {
      const dx = samples[i] - cx;
      const dy = samples[i + 1] - cy;
      const dz = samples[i + 2] - cz;
      maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
    });
    // A nozzle cap is a compact disk on a protruding tip, not a broad body face.
    if (maxR < 0.05 || maxR > 0.3) return;
    let score = max - maxR * 0.4;
    if (axis[2] === 1) score += 1.4;
    if (!best || score > best.score) {
      best = {
        dir: new THREE.Vector3(axis[0], axis[1], axis[2]),
        center: new THREE.Vector3(cx, cy, cz),
        radius: maxR,
        score,
      };
    }
  });
  if (!best) {
    best = {
      dir: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(0, 0, 0.4),
      radius: 0.18,
      score: 0,
    };
  }
  return best;
}

function seatEmitter(parent, barrel, lensMat) {
  const shroudMat = new THREE.MeshStandardMaterial({ color: 0x14171b, metalness: 0.78, roughness: 0.34 });
  const theta = 0.92;
  const radius = barrel.radius / Math.sin(theta);
  const shroud = new THREE.Mesh(
    new THREE.CylinderGeometry(barrel.radius * 0.84, barrel.radius * 0.92, barrel.radius * 0.36, 36, 1, true),
    shroudMat,
  );
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 20, 0, Math.PI * 2, 0, theta),
    lensMat,
  );
  const outward = barrel.dir.clone().normalize();
  shroud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
  lens.quaternion.copy(shroud.quaternion);
  shroud.position.copy(barrel.center).addScaledVector(outward, -barrel.radius * 0.16);
  lens.position.copy(barrel.center).addScaledVector(outward, -radius * Math.cos(theta));
  parent.add(shroud, lens);
}
