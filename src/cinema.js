import * as THREE from "three";
import { SATS, anomaly, orbitPoint, visualNow } from "./orbit.js";
import { createEarth } from "./earth.js";
import { createSpacecraft } from "./satellite.js";
import { CRAFT, HOLDS, MIN_ALT } from "./shots.js";

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
// Critically damped follow of the rail position. omega 12/s settles a hold
// change in about 0.35 s with no overshoot, at any frame rate.
const OMEGA = 12;
const RING_LABELS = [
  { sat: 0, label: "LEO", dir: [-0.35, 1] },
  { sat: 2, label: "Sun-synchronous", dir: [1, 0.15] },
  { sat: 3, label: "GEO, drawn closer than true", dir: [0.65, -0.75] },
];

const dotArr = [0, 0, 0];
const tmp = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const proj = new THREE.Vector3();
const rayCam = new THREE.PerspectiveCamera();
const basis = new THREE.Matrix4();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function ease(t) {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function latLon(lat, lon, radius, out) {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  out.set(radius * c * Math.sin(lo), radius * Math.sin(la), radius * c * Math.cos(lo));
  return out;
}

// Spherical interpolation of two directions (unit vectors) into out.
function slerpDir(a, b, t, out) {
  const d = clamp(a.dot(b), -1, 1);
  const ang = Math.acos(d);
  if (ang < 1e-5) return out.copy(a).lerp(b, t).normalize();
  if (Math.PI - ang < 1e-3) {
    // Antipodal: go around through a perpendicular so the path is defined.
    tmpC.crossVectors(a, UP);
    if (tmpC.lengthSq() < 1e-6) tmpC.set(1, 0, 0);
    tmpC.normalize();
    const half = t * Math.PI;
    return out.copy(a).multiplyScalar(Math.cos(half)).addScaledVector(tmpC, Math.sin(half));
  }
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s;
  const wb = Math.sin(t * ang) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}

function nadirQuat(pos, q) {
  yAxis.copy(pos).normalize();
  zAxis.crossVectors(yAxis, UP);
  if (zAxis.lengthSq() < 1e-6) zAxis.set(1, 0, 0);
  zAxis.normalize();
  xAxis.crossVectors(yAxis, zAxis).normalize();
  basis.makeBasis(xAxis, yAxis, zAxis);
  return q.setFromRotationMatrix(basis);
}

function beautyQuat(pos, eye, q) {
  zAxis.subVectors(eye, pos).normalize();
  xAxis.crossVectors(UP, zAxis);
  if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
  xAxis.normalize();
  yAxis.crossVectors(zAxis, xAxis).normalize();
  basis.makeBasis(xAxis, yAxis, zAxis);
  return q.setFromRotationMatrix(basis);
}

function orbitLine(sat, color) {
  const pts = [];
  for (let i = 0; i <= 240; i += 1) {
    orbitPoint(sat.radius, sat.inc, sat.raan, (i / 240) * Math.PI * 2, dotArr);
    pts.push(new THREE.Vector3(dotArr[0], dotArr[1], dotArr[2]));
  }
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, toneMapped: false });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  line.frustumCulled = false;
  line.userData.points = pts.filter((_, i) => i % 5 === 0);
  return line;
}

function makePose() {
  return {
    eye: new THREE.Vector3(),
    target: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    fov: 34,
    ox: 0,
    oy: 0,
    sun: new THREE.Vector3(1, 0, 0),
    sat: new THREE.Vector3(1.4, 0, 0),
    satQuat: new THREE.Quaternion(),
    satScale: 1,
    craftLocal: new THREE.Vector3(0, 0, 1),
    craft: false,
    orbits: 0,
    clouds: 1,
    glint: 1,
    swath: 0,
    aim: new THREE.Vector3(),
  };
}

export function createCinema(canvas, { onRestored }) {
  const mobile = window.matchMedia("(max-width: 767px)").matches;
  const memory = navigator.deviceMemory || 8;
  const hiRes = !mobile && memory >= 4;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !mobile,
      alpha: false,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: false,
    });
  } catch (err) {
    return null;
  }
  if (!renderer.getContext()) return null;

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x07080a, 1);
  // Resolution is capped, then adapts: if frames run long during a move we
  // render fewer pixels, and step back up once the GPU has headroom again.
  const maxRatio = () => Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
  const minRatio = () => Math.min(maxRatio(), 0.75);
  let ratio = maxRatio();
  renderer.setPixelRatio(ratio);
  const frameLog = new Float32Array(36);
  let frameCount = 0;
  let lastFrameAt = 0;
  let lastScaleAt = 0;
  let upBlockedUntil = 0;
  let lastDown = 0;

  const scene = new THREE.Scene();
  const baseFov = () => (window.innerWidth < 768 ? 42 : 34);
  const camera = new THREE.PerspectiveCamera(baseFov(), 1, 0.01, 60);
  const earth = createEarth(scene, renderer, { mobile, hiRes });
  const craft = createSpacecraft();
  scene.add(craft.group);
  const craftScale = craft.group.scale.x;

  const orbits = new THREE.Group();
  const orbitMats = [];
  [
    [SATS[0], 0xe6e0d4],
    [SATS[1], 0xb7b1a4],
    [SATS[2], 0x9ec2c6],
    [SATS[3], 0x8a8172],
  ].forEach(([sat, color], index) => {
    const line = orbitLine(sat, color);
    line.userData.base = index === 3 ? 0.45 : 0.75;
    orbits.add(line);
    orbitMats.push(line);
  });
  scene.add(orbits);

  const dots = SATS.slice(1).map((sat) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(sat.kind === "geo" ? 0.02 : 0.014, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xe6e0d4, toneMapped: false }),
    );
    mesh.userData.sat = sat;
    scene.add(mesh);
    return mesh;
  });

  const stars = new Float32Array(180 * 3);
  for (let i = 0; i < 180; i += 1) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(30);
    stars[i * 3] = v.x;
    stars[i * 3 + 1] = v.y;
    stars[i * 3 + 2] = v.z;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xd9d3c6,
    size: 0.06,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    toneMapped: false,
  })));

  const sunLight = new THREE.DirectionalLight(0xfff3e4, 4.6);
  const fill = new THREE.DirectionalLight(0xc5d4e4, 1.7);
  const rim = new THREE.DirectionalLight(0xffd2a8, 1.5);
  scene.add(sunLight, fill, rim, new THREE.AmbientLight(0x314155, 0.85));

  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.0022, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xe6e0d4, transparent: true, toneMapped: false }),
  );
  marker.visible = false;
  scene.add(marker);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xd9d0c2,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  cone.visible = false;
  cone.renderOrder = 4;
  scene.add(cone);

  // Spacecraft holds: one fixed place and attitude in orbit.
  const craftPos = latLon(CRAFT.lat, CRAFT.lon, CRAFT.radius, new THREE.Vector3());
  const craftQuat = nadirQuat(craftPos, new THREE.Quaternion());
  const craftMatrix = new THREE.Matrix4().compose(craftPos, craftQuat, new THREE.Vector3(craftScale, craftScale, craftScale));
  const craftUp = craftPos.clone().normalize();

  let booted = false;
  const api = { lost: false, onRestored };
  const poseA = makePose();
  const poseB = makePose();
  const shown = makePose();
  const pins = [];
  const rail = { p: 0, v: 0, last: 0, init: false, hold: -1 };
  let kicked = false;
  let frameFree = null;

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    api.lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    api.lost = false;
    if (api.onRestored) api.onRestored();
  });

  earth.ready.catch((err) => console.error(err));
  craft.ready.catch((err) => console.error(err));

  function adapt(now) {
    const gap = lastFrameAt ? now - lastFrameAt : 0;
    lastFrameAt = now;
    // Ignore paused tabs and the boot/upload window; only sustained cost counts.
    if (!gap || gap > 400 || !booted) return;
    frameLog[frameCount % frameLog.length] = gap;
    frameCount += 1;
    if (frameCount < frameLog.length || now - lastScaleAt < 900) return;
    const sorted = Array.from(frameLog).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    let next = ratio;
    if (median > 21 && ratio > minRatio() + 0.01) {
      // Jump straight to the size that should fit the frame budget: each resize
      // reallocates the drawing buffer, so one step beats several small ones.
      next = Math.max(minRatio(), Math.min(ratio * 0.84, ratio * Math.sqrt(16 / median)));
      if (now - lastDown < 6000) upBlockedUntil = now + 12000;
      lastDown = now;
    } else if (median < 13.5 && ratio < maxRatio() - 0.01 && now > upBlockedUntil) {
      next = Math.min(maxRatio(), ratio * 1.12);
    }
    if (Math.abs(next - ratio) < 0.01) return;
    ratio = next;
    lastScaleAt = now;
    frameCount = 0;
    renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, Math.max(1, window.innerHeight), false);
  }

  // Compile every program, upload every texture, and draw every zone overlay
  // once before the reader gets there, so a first visit never stalls on a
  // compile or a driver's first-draw work. The warm draw is overwritten by the
  // real frame rendered right after it, so nothing flashes.
  let warmState = 0;
  function warmDraw() {
    warmState = 2;
    const flipped = [];
    const culled = [];
    const show = (obj) => {
      if (!obj.visible) {
        obj.visible = true;
        flipped.push(obj);
      }
      if (obj.frustumCulled) {
        obj.frustumCulled = false;
        culled.push(obj);
      }
    };
    Object.values(earth.overlays.nodes).forEach((node) => node.traverse(show));
    [marker, cone, earth.clouds, earth.atmo].forEach(show);
    scene.traverse((obj) => {
      const list = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      list.forEach((mat) => {
        for (const key in mat) {
          const value = mat[key];
          if (value && value.isTexture) renderer.initTexture(value);
        }
      });
    });
    try {
      renderer.render(scene, camera);
    } finally {
      flipped.forEach((obj) => { obj.visible = false; });
      culled.forEach((obj) => { obj.frustumCulled = true; });
    }
  }

  // The Meshy craft compiles off the main thread (KHR_parallel_shader_compile)
  // while hidden, then appears, instead of freezing its first frame.
  craft.group.visible = false;
  craft.ready.then(() => {
    craft.group.traverse((obj) => {
      if (!obj.material) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      list.forEach((mat) => {
        for (const key in mat) {
          const value = mat[key];
          if (value && value.isTexture) renderer.initTexture(value);
        }
      });
    });
    craft.group.visible = true;
    const pending = renderer.compileAsync ? renderer.compileAsync(craft.group, camera, scene) : null;
    craft.group.visible = false;
    return Promise.resolve(pending).catch(() => {}).then(() => {
      craft.group.visible = true;
      const idle = () => { warmState = 1; };
      if (typeof requestIdleCallback === "function") requestIdleCallback(idle, { timeout: 600 });
      else setTimeout(idle, 200);
    });
  }).catch(() => {
    craft.group.visible = true;
    warmState = 1;
  });

  function resize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    ratio = Math.min(Math.max(ratio, minRatio()), maxRatio());
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  // ---- The rail -----------------------------------------------------------

  // Map scroll to a rail position: each section holds its shot for 45% of a
  // viewport of scroll (centred on the section filling the screen) and
  // travels to the next over the remaining 55%.
  function railTarget(scrollY, layout) {
    const beats = layout?.beats || [];
    const vh = layout?.vh || window.innerHeight;
    if (!beats.length) return 0;
    const pad = vh * 0.225;
    let last = 0;
    for (let i = 0; i < beats.length; i += 1) {
      const holdStart = beats[i].top - pad;
      const holdEnd = beats[i].top + Math.max(0, beats[i].height - vh) + pad;
      const idx = beats[i].hold;
      if (scrollY < holdStart) {
        if (i === 0) return idx;
        const prevEnd = beats[i - 1].top + Math.max(0, beats[i - 1].height - vh) + pad;
        const t = clamp((scrollY - prevEnd) / Math.max(1, holdStart - prevEnd), 0, 1);
        return last + (idx - last) * t;
      }
      if (scrollY <= holdEnd) return idx;
      last = idx;
    }
    return last;
  }

  function freeFor(id, layout) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const f = layout?.free?.[id];
    if (f) return f;
    return { cx: vw * 0.5, cy: vh * 0.5, w: vw, h: vh };
  }

  function setRayCamera(eye, target, up, fov, ox, oy) {
    rayCam.fov = fov;
    rayCam.aspect = camera.aspect || 1;
    rayCam.position.copy(eye);
    rayCam.up.copy(up);
    rayCam.lookAt(target);
    applyOffset(rayCam, ox, oy);
    rayCam.updateMatrixWorld(true);
  }

  function applyOffset(cam, ox, oy) {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    if (Math.abs(ox) < 1e-4 && Math.abs(oy) < 1e-4) {
      cam.clearViewOffset();
    } else {
      cam.setViewOffset(w, h, -ox * w * 0.5, oy * h * 0.5, w, h);
    }
    cam.updateProjectionMatrix();
  }

  // Pixel radius on screen -> angular half-size, for the current fov.
  function halfAngle(px, fov) {
    const h = Math.max(1, window.innerHeight);
    const focal = (h * 0.5) / Math.tan(fov * 0.5 * DEG);
    return Math.atan(px / focal);
  }

  function holdPose(index, layout, out) {
    const hold = HOLDS[clamp(index, 0, HOLDS.length - 1)];
    const narrow = window.innerWidth < 768;
    const v = narrow ? hold.mobile : hold.desktop;
    const free = freeFor(hold.id, layout);
    const vw = window.innerWidth;
    const vh = Math.max(1, window.innerHeight);
    out.ox = (free.cx / vw) * 2 - 1;
    out.oy = 1 - (free.cy / vh) * 2;
    out.orbits = hold.orbits || 0;
    out.clouds = hold.clouds == null ? 1 : hold.clouds;
    out.glint = hold.glint == null ? 1 : hold.glint;
    out.swath = hold.swath ? 1 : 0;
    out.craft = hold.subject === "craft";
    const span = Math.max(120, Math.min(free.w, free.h)) * (v.frame || 1) * 0.5;

    if (hold.subject === "craft") {
      out.fov = hold.fov * (v.fovScale || 1);
      out.craftLocal.set(hold.dir[0], hold.dir[1], hold.dir[2]).normalize();
      tmp.copy(out.craftLocal).applyQuaternion(craftQuat);
      out.eye.copy(craftPos).addScaledVector(tmp, CRAFT.orbit);
      anchorWorld(hold.anchor, out.target);
      out.up.copy(craftUp);
      out.sat.copy(craftPos);
      out.satQuat.copy(craftQuat);
      out.satScale = 1;
      out.sun.set(hold.sun[0], hold.sun[1], hold.sun[2]).normalize().applyQuaternion(craftQuat);
      out.aim.copy(craftPos).normalize();
      return hold;
    }

    out.fov = baseFov();
    if (hold.subject === "earth") {
      latLon(hold.view.lat, hold.view.lon, 1, tmp);
      const a = halfAngle(span, out.fov);
      const dist = 1 / Math.sin(Math.max(0.02, a));
      out.eye.copy(tmp).multiplyScalar(dist);
      out.target.set(0, 0, 0);
      out.aim.copy(tmp);
    } else {
      latLon(hold.lat, hold.lon, 1, out.target);
      const n = tmp.copy(out.target).normalize();
      const east = tmpB.crossVectors(UP, n).normalize();
      const north = tmpC.crossVectors(n, east).normalize();
      const a = halfAngle(span, out.fov);
      const alt = Math.max(MIN_ALT, hold.radius / Math.tan(a));
      const tilt = (hold.tilt || 0) * DEG;
      // Look from slightly south, so relief and the limb read as a place.
      const dir = new THREE.Vector3().copy(n).multiplyScalar(Math.cos(tilt)).addScaledVector(north, -Math.sin(tilt));
      out.eye.copy(out.target).addScaledVector(dir, alt / Math.cos(tilt));
      if (out.eye.length() < 1 + MIN_ALT) out.eye.setLength(1 + MIN_ALT);
      out.aim.copy(out.target);
    }
    out.up.copy(UP);

    // Art-directed sun, given in the camera's frame.
    zAxis.subVectors(out.eye, out.target).normalize();
    xAxis.crossVectors(out.up, zAxis).normalize();
    yAxis.crossVectors(zAxis, xAxis).normalize();
    out.sun.set(0, 0, 0)
      .addScaledVector(xAxis, hold.sun[0])
      .addScaledVector(yAxis, hold.sun[1])
      .addScaledVector(zAxis, hold.sun[2])
      .normalize();

    // Spacecraft placement: a point on screen, inside the free area, at a depth.
    const s = v.sat;
    setRayCamera(out.eye, out.target, out.up, out.fov, out.ox, out.oy);
    const nx = ((free.cx + s.sx * free.w * 0.5) / vw) * 2 - 1;
    const ny = 1 - ((free.cy - s.sy * free.h * 0.5) / vh) * 2;
    proj.set(nx, ny, 0.5).unproject(rayCam).sub(out.eye).normalize();
    const dist = s.dist != null ? s.dist : out.eye.distanceTo(out.target) * s.depth;
    out.sat.copy(out.eye).addScaledVector(proj, dist);
    if (out.sat.length() < 1.12) out.sat.setLength(1.12);
    out.satScale = s.scale;
    if (hold.satMode === "beauty") beautyQuat(out.sat, out.eye, out.satQuat);
    else nadirQuat(out.sat, out.satQuat);
    return hold;
  }

  function anchorWorld(name, out) {
    const obj = craft.anchors[name];
    if (!obj) return out.copy(craftPos);
    // Anchor in the craft's fixed spacecraft-hold pose.
    obj.updateWorldMatrix(true, false);
    tmpB.setFromMatrixPosition(obj.matrixWorld);
    craft.group.updateMatrixWorld(true);
    tmpC.copy(tmpB).applyMatrix4(tmpMat.copy(craft.group.matrixWorld).invert());
    return out.copy(tmpC).applyMatrix4(craftMatrix);
  }
  const tmpMat = new THREE.Matrix4();

  const dA = new THREE.Vector3();
  const dB = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function blend(a, b, t, out) {
    const k = ease(t);
    out.fov = a.fov + (b.fov - a.fov) * k;
    out.ox = a.ox + (b.ox - a.ox) * k;
    out.oy = a.oy + (b.oy - a.oy) * k;
    out.orbits = a.orbits + (b.orbits - a.orbits) * k;
    out.clouds = a.clouds + (b.clouds - a.clouds) * k;
    out.glint = a.glint + (b.glint - a.glint) * k;
    out.swath = a.swath + (b.swath - a.swath) * k;
    out.satScale = a.satScale + (b.satScale - a.satScale) * k;
    out.craft = k < 0.5 ? a.craft : b.craft;
    slerpDir(dA.copy(a.sun), dB.copy(b.sun), k, out.sun);
    out.up.copy(a.up).lerp(b.up, k).normalize();
    out.satQuat.copy(a.satQuat).slerp(b.satQuat, k);
    out.aim.copy(a.aim).lerp(b.aim, k);

    if (a.craft && b.craft) {
      // Orbit the fixed spacecraft at one constant distance.
      slerpDir(dA.copy(a.craftLocal), dB.copy(b.craftLocal), k, dir).applyQuaternion(craftQuat);
      out.eye.copy(craftPos).addScaledVector(dir, CRAFT.orbit);
      out.target.copy(a.target).lerp(b.target, k);
      out.sat.copy(craftPos);
      return out;
    }

    // Everything else travels on great circles around the Earth, lifted in
    // proportion to the arc so the globe turns underneath.
    const rA = a.eye.length();
    const rB = b.eye.length();
    dA.copy(a.eye).normalize();
    dB.copy(b.eye).normalize();
    const arc = Math.acos(clamp(dA.dot(dB), -1, 1));
    slerpDir(dA, dB, k, dir);
    const lift = arc * 0.55 * Math.sin(Math.PI * k);
    out.eye.copy(dir).multiplyScalar(Math.max(1 + MIN_ALT, rA + (rB - rA) * k + lift));

    const tA = a.target.length();
    const tB = b.target.length();
    if (tA > 0.3 && tB > 0.3) {
      slerpDir(dA.copy(a.target).normalize(), dB.copy(b.target).normalize(), k, dir);
      out.target.copy(dir).multiplyScalar(tA + (tB - tA) * k);
    } else {
      out.target.copy(a.target).lerp(b.target, k);
    }
    // As the camera lifts, pull the aim toward the Earth's centre so the
    // whole globe frames the move instead of a smear of ground.
    const pull = Math.sin(Math.PI * k) * clamp(arc / 0.6, 0, 1) * 0.85;
    out.target.multiplyScalar(1 - pull);

    const sA = a.sat.length();
    const sB = b.sat.length();
    slerpDir(dA.copy(a.sat).normalize(), dB.copy(b.sat).normalize(), k, dir);
    out.sat.copy(dir).multiplyScalar(Math.max(1.12, sA + (sB - sA) * k + lift * 0.6));
    return out;
  }

  // ---- Labels -------------------------------------------------------------

  function project(world, out) {
    out.copy(world).project(camera);
    return out;
  }

  function occluded(point) {
    // Is the Earth (radius 1) between the camera and this point?
    tmp.copy(point).sub(camera.position);
    const len = tmp.length();
    tmp.divideScalar(len);
    const b = camera.position.dot(tmp);
    const c = camera.position.lengthSq() - 1;
    const disc = b * b - c;
    if (disc <= 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < len - 1e-3;
  }

  function pushPin(world, label, w, h, side) {
    project(world, proj);
    if (proj.z > 1) return;
    const x = (proj.x * 0.5 + 0.5) * w;
    const y = (-proj.y * 0.5 + 0.5) * h;
    if (x < 8 || y < 70 || x > w - 8 || y > h - 8) return;
    const right = side == null ? x < w * 0.7 : side > 0;
    const labelX = clamp(x + (right ? 28 : -28 - Math.min(240, label.length * 7.4 + 18)), 8, w - 200);
    const labelY = clamp(y - 30 - pins.length * 4, 72, h - 36);
    pins.push({ x, y, labelX, labelY, label });
  }

  function buildPins(hold, settle) {
    pins.length = 0;
    if (!hold || settle < 0.85) return;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (hold.subject === "craft" && hold.pins) {
      hold.pins.forEach(([name, label]) => {
        const obj = craft.anchors[name];
        if (!obj) return;
        obj.getWorldPosition(tmpB);
        pushPin(tmpB, label, w, h);
      });
      return;
    }
    if (hold.labels === "site") {
      latLon(hold.lat, hold.lon, 1.004, tmpB);
      pushPin(tmpB, hold.label, w, h, 1);
      return;
    }
    if (hold.labels === "orbits") {
      project(tmpB.set(0, 0, 0), proj);
      const cx = (proj.x * 0.5 + 0.5) * w;
      const cy = (-proj.y * 0.5 + 0.5) * h;
      RING_LABELS.forEach((spec) => {
        const line = orbitMats[spec.sat];
        let best = null;
        let bestScore = -Infinity;
        line.userData.points.forEach((pt) => {
          if (occluded(pt)) return;
          project(pt, proj);
          if (proj.z > 1) return;
          const x = (proj.x * 0.5 + 0.5) * w;
          const y = (-proj.y * 0.5 + 0.5) * h;
          if (x < 20 || x > w - 20 || y < 80 || y > h - 20) return;
          const score = (x - cx) * spec.dir[0] - (y - cy) * spec.dir[1];
          if (score > bestScore) {
            bestScore = score;
            best = pt;
          }
        });
        if (best) pushPin(best, spec.label, w, h, spec.dir[0] >= 0 ? 1 : -1);
      });
    }
  }

  // ---- Draw ---------------------------------------------------------------

  function draw(state) {
    if (api.lost) return { pins: [], beat: "hero" };
    const now = state.now;
    if (!state.reduced) adapt(now);
    const dt = rail.last ? (now - rail.last) / 1000 : 0;
    rail.last = now;
    const layout = state.layout;

    let goal = state.hold != null ? state.hold : railTarget(state.scrollY, layout);
    if (state.reduced) goal = Math.round(goal);
    if (!rail.init || state.reduced || dt > 1 || dt <= 0 && !booted) {
      rail.p = goal;
      rail.v = 0;
      rail.init = true;
    } else if (dt > 0) {
      // Exact critically damped spring step: frame-rate independent, no clamp.
      const y = rail.p - goal;
      const e = Math.exp(-OMEGA * dt);
      const c = rail.v + OMEGA * y;
      rail.p = goal + (y + c * dt) * e;
      rail.v = (rail.v - OMEGA * c * dt) * e;
      if (Math.abs(rail.p - goal) < 1e-4 && Math.abs(rail.v) < 1e-3) {
        rail.p = goal;
        rail.v = 0;
      }
    }

    const p = clamp(rail.p, 0, HOLDS.length - 1);
    const i = Math.min(HOLDS.length - 2, Math.floor(p));
    const t = p - i;
    const holdA = holdPose(i, layout, poseA);
    const holdB = holdPose(i + 1, layout, poseB);
    blend(poseA, poseB, t, shown);

    const nearest = t < 0.5 ? holdA : holdB;
    const settle = 1 - Math.min(1, Math.abs(t - (t < 0.5 ? 0 : 1)) * 8);

    camera.fov = shown.fov;
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.position.copy(shown.eye);
    camera.up.copy(shown.up);
    camera.lookAt(shown.target);
    applyOffset(camera, shown.ox, shown.oy);
    camera.updateMatrixWorld(true);

    craft.group.position.copy(shown.sat);
    craft.group.quaternion.copy(shown.satQuat);
    craft.group.scale.setScalar(craftScale * shown.satScale);
    craft.group.updateMatrixWorld(true);

    const sun = shown.sun;
    craft.update(dt || 0.016, { sun, reduced: state.reduced, now, tour: nearest.id, mode: shown.craft ? "tour" : "nadir" });
    const industry = settle > 0.2 || t < 0.25 || t > 0.75 ? nearest.industry || "" : "";
    earth.update(dt || 0.016, camera, sun, { cloud: shown.clouds, glint: shown.glint, industry, sat: shown.sat }, state.reduced);

    sunLight.position.copy(sun).multiplyScalar(8);
    fill.position.copy(camera.position);
    rim.position.copy(shown.sat).addScaledVector(tmpB.crossVectors(sun, UP).normalize(), 2);

    orbitMats.forEach((line) => {
      line.material.opacity = line.userData.base * shown.orbits;
      line.visible = line.material.opacity > 0.02;
    });
    dots.forEach((dot) => {
      const sat = dot.userData.sat;
      orbitPoint(sat.radius, sat.inc, sat.raan, anomaly(sat, visualNow(now, state.reduced)), dotArr);
      dot.position.set(dotArr[0], dotArr[1], dotArr[2]);
      dot.visible = shown.orbits > 0.2;
    });

    const showSwath = shown.swath > 0.05;
    marker.visible = showSwath;
    cone.visible = showSwath;
    if (showSwath) {
      const aim = tmpC.copy(shown.aim).setLength(1.004);
      marker.position.copy(aim);
      marker.quaternion.setFromUnitVectors(UP, tmp.copy(aim).normalize());
      marker.material.opacity = shown.swath;
      cone.material.opacity = 0.14 * shown.swath;
      const len = Math.max(0.05, tmpB.copy(aim).sub(shown.sat).length());
      cone.scale.set(0.05, len, 0.05);
      cone.position.copy(shown.sat).add(aim).multiplyScalar(0.5);
      cone.quaternion.setFromUnitVectors(UP, tmp.copy(aim).sub(shown.sat).normalize());
    }

    if (warmState === 1) warmDraw();
    renderer.render(scene, camera);
    booted = true;
    if (!kicked) {
      kicked = true;
      const kick = () => {
        Promise.resolve(earth.loadRest()).then(() => {
          const launch = () => craft.start();
          if (typeof requestIdleCallback === "function") requestIdleCallback(launch, { timeout: 240 });
          else setTimeout(launch, 120);
        }).catch((err) => console.error(err));
      };
      if (typeof requestIdleCallback === "function") requestIdleCallback(kick, { timeout: 480 });
      else setTimeout(kick, 120);
    }
    buildPins(nearest, settle);
    rail.hold = settle > 0.5 ? (t < 0.5 ? i : i + 1) : -1;
    return { pins, beat: nearest.id, industry, rail: p, settle };
  }

  resize();
  api.resize = resize;
  api.draw = draw;
  api.lost = false;
  api.rail = rail;
  api.holdAt = (scrollY, layout) => Math.round(railTarget(scrollY, layout));
  api.camera = camera;
  return api;
}
