import * as THREE from "three";
import { LEAD, SATS, anomaly, orbitPoint, sunDirectionInto, visualNow } from "./orbit.js";
import { createEarth } from "./earth.js";
import { createSpacecraft } from "./satellite.js";

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const INDUSTRY = {
  defense: [35.95, -5.6],
  agriculture: [36.6, -119.8],
  construction: [36.9, -76.1],
  weather: [28, -68],
  energy: [32.2, -101.2],
  maritime: [2.7, 102.4],
};
const TOUR = {
  optics: { eye: [0.22, 0.32, 2.35], look: [0, 0.02, 0.36], pins: [["optics", "Multispectral telescope"]] },
  comms: { eye: [2.35, 0.15, 1.45], look: [0.72, -0.12, 0.12], pins: [["comms", "Laser-com terminal"], ["array", "Ka/X-band array"]] },
  solar: { eye: [0.55, 1.15, 2.45], look: [1.15, 0.15, 0.05], pins: [["solar", "Solar wing"], ["mli", "Kapton MLI"]] },
  propulsion: { eye: [1.15, 0.48, -1.85], look: [0.05, 0.08, -0.62], pins: [["thruster", "Hall thruster"], ["tracker", "Star tracker"]] },
};
const PIN_BEATS = new Set(["optics", "comms", "solar", "propulsion"]);

const sunArr = [0, 0, 0];
const leadArr = [0, 0, 0];
const dotArr = [0, 0, 0];
const sun = new THREE.Vector3();
const side = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const eyeA = new THREE.Vector3();
const eyeB = new THREE.Vector3();
const tgtA = new THREE.Vector3();
const tgtB = new THREE.Vector3();
const satA = new THREE.Vector3();
const satB = new THREE.Vector3();
const eyeD = new THREE.Vector3();
const tgtD = new THREE.Vector3();
const satD = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qD = new THREE.Quaternion();
const basis = new THREE.Matrix4();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();
const local = new THREE.Vector3();
const aim = new THREE.Vector3();
const nadir = new THREE.Vector3();
const axis = new THREE.Vector3();
const ray = new THREE.Vector3();
const proj = new THREE.Vector3();

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smooth(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function latLon(lat, lon, radius, out) {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  out.set(radius * c * Math.sin(lo), radius * Math.sin(la), radius * c * Math.cos(lo));
  return out;
}

function sideOf(sunDir) {
  side.crossVectors(sunDir, UP);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  return side.normalize();
}

function leadPos(now, reduced, out) {
  orbitPoint(LEAD.radius, LEAD.inc, LEAD.raan, anomaly(LEAD, visualNow(now, reduced)), leadArr);
  out.set(leadArr[0], leadArr[1], leadArr[2]);
  return out;
}

function place(out, eye, target, sat, mode, extra) {
  out.eye.copy(eye);
  out.target.copy(target);
  out.sat.copy(sat);
  out.mode = mode;
  out.cloud = extra.cloud;
  out.orbits = extra.orbits;
  out.industry = extra.industry || "";
  out.tour = extra.tour || "";
  out.swath = extra.swath || false;
  out.tilt = extra.tilt || 0;
}

function fillPose(id, ctx, out) {
  const s = ctx.sun;
  sideOf(s);
  if (id === "hero") {
    eyeD.copy(s).multiplyScalar(1.15).addScaledVector(side, 2.95).addScaledVector(UP, 0.58);
    tgtD.copy(s).multiplyScalar(0.12);
    const sweep = ctx.reduced ? 0 : Math.sin(ctx.now * 0.00012) * 0.08;
    satD.copy(eyeD).normalize().multiplyScalar(1.92);
    satD.addScaledVector(UP, 0.2 + sweep);
    satD.addScaledVector(s, 0.32);
    place(out, eyeD, tgtD, satD, "beauty", { cloud: 1, orbits: 0.45 });
    return;
  }
  if (id === "capability") {
    eyeD.copy(s).multiplyScalar(1.15).addScaledVector(side, 2.55).addScaledVector(UP, 1.35);
    satD.copy(eyeD).normalize().multiplyScalar(1.42);
    place(out, eyeD, tmp.set(0, 0, 0), satD, "nadir", { cloud: 1, orbits: 1 });
    return;
  }
  if (INDUSTRY[id]) {
    const [lat, lon] = INDUSTRY[id];
    latLon(lat, lon, 1, tgtD);
    const n = tmp.copy(tgtD).normalize();
    const east = tmpB.crossVectors(UP, n);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    const north = tmpC.crossVectors(n, east).normalize();
    eyeD.copy(tgtD).addScaledVector(n, 0.33).addScaledVector(east, 0.035);
    satD.copy(tgtD).addScaledVector(n, 1.22).addScaledVector(north, 0.42).addScaledVector(east, -0.2);
    place(out, eyeD, tgtD, satD, "nadir", { cloud: 0.12, orbits: 0, industry: id, swath: true });
    return;
  }
  if (TOUR[id]) {
    satD.copy(s).multiplyScalar(0.25).addScaledVector(side, 0.72).addScaledVector(UP, 0.16).normalize().multiplyScalar(1.46);
    eyeD.copy(satD).addScaledVector(s, 0.35);
    place(out, eyeD, satD, satD, "tour", { cloud: 0.55, orbits: 0, tour: id });
    return;
  }
  if (id === "console") {
    latLon(ctx.pass.lat, ctx.pass.lon, 1, tgtD);
    const n = tmp.copy(tgtD).normalize();
    const east = tmpB.crossVectors(UP, n);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    eyeD.copy(tgtD).addScaledVector(n, 0.92).addScaledVector(east, 0.55).addScaledVector(UP, 0.18);
    satD.copy(tgtD).addScaledVector(n, 0.78).addScaledVector(east, 0.12);
    place(out, eyeD, tgtD, satD, "nadir", { cloud: 0.45, orbits: 0.35, swath: true, tilt: ctx.pass.off });
    return;
  }
  if (id === "briefing") {
    eyeD.copy(s).multiplyScalar(-2.35).addScaledVector(UP, 0.48);
    tgtD.copy(s).multiplyScalar(-0.2).addScaledVector(UP, 0.05);
    satD.copy(s).multiplyScalar(-0.85).addScaledVector(side, 0.35).addScaledVector(UP, 0.12).normalize().multiplyScalar(1.5);
    place(out, eyeD, tgtD, satD, "beauty", { cloud: 0.4, orbits: 0.12 });
    return;
  }
  eyeD.copy(s).multiplyScalar(0.55).addScaledVector(side, 2.35).addScaledVector(UP, 0.85);
  leadPos(ctx.now, ctx.reduced, satD);
  if (satD.length() < 1.36) satD.multiplyScalar(1.36 / satD.length());
  place(out, eyeD, tmp.set(0, 0.05, 0), satD, "nadir", { cloud: 0.85, orbits: 0.7 });
}

function quatFor(mode, satPos, eyePos, q) {
  if (mode === "beauty") {
    zAxis.subVectors(eyePos, satPos).normalize();
  } else if (mode === "tour") {
    zAxis.copy(satPos).normalize();
  } else {
    yAxis.copy(satPos).normalize();
    zAxis.crossVectors(yAxis, UP);
    if (zAxis.lengthSq() < 1e-6) zAxis.set(1, 0, 0);
    zAxis.normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();
    basis.makeBasis(xAxis, yAxis, zAxis);
    q.setFromRotationMatrix(basis);
    return q;
  }
  xAxis.crossVectors(UP, zAxis);
  if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
  xAxis.normalize();
  yAxis.crossVectors(zAxis, xAxis).normalize();
  basis.makeBasis(xAxis, yAxis, zAxis);
  q.setFromRotationMatrix(basis);
  return q;
}

function dampRadius(cur, desired, f, minR) {
  const r0 = Math.max(cur.length(), 1e-4);
  const r1 = Math.max(desired.length(), 1e-4);
  tmp.copy(cur).multiplyScalar(1 / r0);
  tmpB.copy(desired).multiplyScalar(1 / r1);
  tmp.lerp(tmpB, f);
  if (tmp.lengthSq() < 1e-6) tmp.copy(tmpB);
  tmp.normalize();
  cur.copy(tmp).multiplyScalar(Math.max(r0 + (r1 - r0) * f, minR));
}

function aimOnEarth(satPos, tiltDeg, out) {
  nadir.copy(satPos).multiplyScalar(-1);
  if (nadir.lengthSq() < 1e-6) nadir.set(0, -1, 0);
  nadir.normalize();
  axis.crossVectors(nadir, UP);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  ray.copy(nadir).applyAxisAngle(axis, tiltDeg * DEG);
  const b = satPos.dot(ray);
  const c = satPos.dot(satPos) - 1.006 * 1.006;
  const disc = b * b - c;
  if (disc <= 0) return out.copy(satPos).normalize().multiplyScalar(1.006);
  const s = Math.sqrt(disc);
  const t1 = -b - s;
  const t2 = -b + s;
  const t = t1 > 0.001 ? t1 : t2;
  return out.copy(satPos).addScaledVector(ray, t);
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
  return line;
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
  const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
  renderer.setPixelRatio(ratio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mobile ? 42 : 34, 1, 0.02, 40);
  const earth = createEarth(scene, renderer, { mobile, hiRes });
  const craft = createSpacecraft();
  scene.add(craft.group);

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
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(16);
    stars[i * 3] = v.x;
    stars[i * 3 + 1] = v.y;
    stars[i * 3 + 2] = v.z;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xd9d3c6,
    size: 0.035,
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
    new THREE.TorusGeometry(0.055, 0.0032, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xe6e0d4, toneMapped: false }),
  );
  marker.visible = false;
  scene.add(marker);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xd9d0c2,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  cone.visible = false;
  cone.renderOrder = 4;
  scene.add(cone);

  const shown = {
    eye: new THREE.Vector3(2.2, 0.4, 2.4),
    target: new THREE.Vector3(),
    sat: new THREE.Vector3(1.2, 0.2, 1.2),
    quat: new THREE.Quaternion(),
    tilt: 0,
    cloud: 1,
    orbits: 0.4,
  };
  let last = 0;
  let booted = false;
  const api = { lost: false, onRestored };
  const poseA = blank();
  const poseB = blank();
  const pins = [];

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

  function resize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function draw(state) {
    if (api.lost) return { pins: [], beat: "hero" };
    const now = state.now;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    sunDirectionInto(Date.now(), sunArr);
    sun.set(sunArr[0], sunArr[1], sunArr[2]).normalize();
    const ctx = { now, reduced: state.reduced, sun, pass: state.pass };
    const beats = state.layout?.beats || [];
    const loc = locate(state.scrollY, state.layout?.vh || window.innerHeight, beats);
    const idA = beats[loc.i]?.id || "hero";
    const idB = beats[Math.min(beats.length - 1, loc.i + 1)]?.id || idA;
    const k = state.reduced ? (loc.t > 0.5 ? 1 : 0) : smooth(loc.t);
    fillPose(idA, ctx, poseA);
    fillPose(idB, ctx, poseB);
    const beat = k > 0.5 ? idB : idA;
    const mode = k > 0.5 ? poseB.mode : poseA.mode;
    const tour = k > 0.5 ? poseB.tour : poseA.tour;
    const industry = k < 0.55 ? poseA.industry : poseB.industry;
    const swath = (k > 0.5 ? poseB.swath : poseA.swath);
    const tilt = poseA.tilt + (poseB.tilt - poseA.tilt) * k;
    const cloud = poseA.cloud + (poseB.cloud - poseA.cloud) * k;
    const orbitMix = poseA.orbits + (poseB.orbits - poseA.orbits) * k;

    dampRadius(shown.sat, satB.copy(poseA.sat).lerp(poseB.sat, k), state.reduced ? 1 : 1 - Math.exp(-8 * dt), 1.16);
    quatFor(poseA.mode, shown.sat, poseA.eye, qA);
    quatFor(poseB.mode, shown.sat, poseB.eye, qB);
    qD.copy(qA).slerp(qB, k);
    shown.quat.slerp(qD, state.reduced || !booted ? 1 : 1 - Math.exp(-8 * dt));

    craft.group.position.copy(shown.sat);
    craft.group.quaternion.copy(shown.quat);
    craft.group.updateMatrixWorld(true);

    const tourWeight = (poseA.mode === "tour" ? 1 - k : 0) + (poseB.mode === "tour" ? k : 0);
    orbitalEye(k);
    let desiredEye = eyeD;
    let desiredTgt = tgtD;
    if (tourWeight > 0.02 && TOUR[tour || poseB.tour || poseA.tour]) {
      const spec = TOUR[tour || (k > 0.5 ? poseB.tour : poseA.tour)] || TOUR.optics;
      local.set(spec.eye[0], spec.eye[1], spec.eye[2]).applyMatrix4(craft.group.matrixWorld);
      tmp.copy(local);
      local.set(spec.look[0], spec.look[1], spec.look[2]).applyMatrix4(craft.group.matrixWorld);
      if (tourWeight > 0.98) {
        desiredEye = tmp;
        desiredTgt = local;
      } else {
        desiredEye = eyeD.lerp(tmp, tourWeight);
        desiredTgt = tgtD.lerp(local, tourWeight);
      }
    }
    const f = state.reduced || !booted ? 1 : 1 - Math.exp(-10 * dt);
    if (tourWeight > 0.98) {
      shown.eye.copy(desiredEye);
      shown.target.copy(desiredTgt);
    } else {
      dampRadius(shown.eye, desiredEye, f, 1.08);
      if (desiredTgt.length() < 0.25 || shown.target.length() < 0.25) {
        shown.target.lerp(desiredTgt, f);
      } else {
        dampRadius(shown.target, desiredTgt, f, 0);
      }
    }
    camera.position.copy(shown.eye);
    camera.up.copy(UP);
    camera.lookAt(shown.target);

    aimOnEarth(shown.sat, swath ? tilt : 0, aim);
    craft.update(dt, {
      sun,
      target: swath ? aim : tmpB.copy(shown.sat).normalize().multiplyScalar(0.2),
      mode: tourWeight > 0.5 ? "tour" : mode,
      tour,
      reduced: state.reduced,
      now,
    });
    earth.update(dt, camera, sun, { cloud, industry: swath && industry ? industry : industry, sat: shown.sat }, state.reduced);

    sunLight.position.copy(sun).multiplyScalar(8);
    fill.position.copy(camera.position);
    rim.position.copy(shown.sat).addScaledVector(side, 2);

    orbitMats.forEach((line) => {
      line.material.opacity = line.userData.base * orbitMix;
      line.visible = line.material.opacity > 0.02;
    });
    dots.forEach((dot) => {
      const sat = dot.userData.sat;
      orbitPoint(sat.radius, sat.inc, sat.raan, anomaly(sat, visualNow(now, state.reduced)), dotArr);
      dot.position.set(dotArr[0], dotArr[1], dotArr[2]);
      dot.visible = orbitMix > 0.2;
    });

    const showSwath = swath && tourWeight < 0.5;
    marker.visible = showSwath;
    cone.visible = showSwath;
    if (showSwath) {
      marker.position.copy(aim);
      marker.quaternion.setFromUnitVectors(UP, tmp.copy(aim).normalize());
      const len = Math.max(0.05, tmpB.copy(aim).sub(shown.sat).length());
      cone.scale.set(0.045 + Math.abs(tilt) * 0.0012, len, 0.045 + Math.abs(tilt) * 0.0012);
      cone.position.copy(shown.sat).add(aim).multiplyScalar(0.5);
      cone.quaternion.setFromUnitVectors(UP, tmpC.copy(aim).sub(shown.sat).normalize());
    }

    renderer.render(scene, camera);
    booted = true;
    pins.length = 0;
    if (tour && PIN_BEATS.has(tour) && tourWeight > 0.62) {
      const spec = TOUR[tour];
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      spec.pins.forEach(([name, label], index) => {
        const obj = craft.anchors[name];
        if (!obj) return;
        obj.getWorldPosition(proj);
        proj.project(camera);
        if (proj.z > 1) return;
        const x = (proj.x * 0.5 + 0.5) * w;
        const y = (-proj.y * 0.5 + 0.5) * h;
        if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return;
        const labelX = clamp(x + (x < w * 0.55 ? 36 : -168), 12, w - 180);
        const labelY = clamp(y + (index ? 28 : -22), 72, h - 36);
        pins.push({ x, y, labelX, labelY, label });
      });
    }
    return { pins, beat, industry };
  }

  function orbitalEye(k) {
    eyeD.copy(poseA.eye).lerp(poseB.eye, k);
    tgtD.copy(poseA.target).lerp(poseB.target, k);
  }

  resize();
  api.resize = resize;
  api.draw = draw;
  api.lost = false;
  return api;
}

function blank() {
  return {
    eye: new THREE.Vector3(),
    target: new THREE.Vector3(),
    sat: new THREE.Vector3(),
    mode: "nadir",
    cloud: 1,
    orbits: 0,
    industry: "",
    tour: "",
    swath: false,
    tilt: 0,
  };
}

function locate(scrollY, vh, beats) {
  if (!beats.length) return { i: 0, t: 0 };
  const focus = scrollY + vh * 0.46;
  for (let i = 0; i < beats.length - 1; i += 1) {
    const a = beats[i].top + beats[i].height * 0.42;
    const b = beats[i + 1].top + beats[i + 1].height * 0.42;
    if (focus < b) return { i, t: clamp((focus - a) / Math.max(1, b - a), 0, 1) };
  }
  return { i: beats.length - 1, t: 0 };
}
