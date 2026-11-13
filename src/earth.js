import * as THREE from "three";

// Geographic frame matches orbit.js: +Y north, longitude 0 at +Z, east toward +X.
// Sphere UVs put longitude 0 at u=0.25, so maps are sampled at u+0.25.

const DEG = Math.PI / 180;

const VERT = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EARTH_FRAG = `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D specMap;
  uniform sampler2D bumpMap;
  uniform vec3 sunDir;
  uniform float hasDay;
  uniform float hasNight;
  uniform float hasSpec;
  uniform float hasBump;
  uniform float uDetail;
  uniform float uGraticule;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;

  void main() {
    vec2 uv = vUv;
    uv.x += 0.25;
    vec3 n = normalize(vNormal);
    vec3 day = mix(vec3(0.04, 0.16, 0.30), texture2D(dayMap, uv).rgb, hasDay);
    float land = smoothstep(0.18, 0.42, day.g - day.b * 0.35);
    day = mix(day, vec3(0.035, 0.11, 0.22), (1.0 - land) * (1.0 - hasDay));
    vec3 night = texture2D(nightMap, uv).rgb * hasNight;
    float specMask = mix(1.0 - land, texture2D(specMap, uv).r, hasSpec);
    if (hasBump > 0.5) {
      float h = texture2D(bumpMap, uv).r;
      float hu = texture2D(bumpMap, uv + vec2(0.0016, 0.0)).r;
      float hv = texture2D(bumpMap, uv + vec2(0.0, 0.0016)).r;
      vec3 t = normalize(dFdx(vWorld));
      vec3 b = normalize(dFdy(vWorld));
      n = normalize(n + t * (h - hu) * 1.05 + b * (h - hv) * 1.05);
    }
    vec3 sun = normalize(sunDir);
    float ndl = dot(n, sun);
    float dayW = smoothstep(-0.12, 0.28, ndl);
    float grain = fract(sin(dot(uv, vec2(412.13, 189.71))) * 43758.5453);
    vec3 albedo = day * mix(1.0, 0.9 + 0.14 * grain, uDetail * land);
    vec3 color = albedo * (0.07 + 1.15 * max(ndl, 0.0));
    color += day * (1.0 - dayW) * 0.38;
    color += night * (1.0 - dayW) * 1.7;
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 halfV = normalize(sun + view);
    float glint = pow(max(dot(n, halfV), 0.0), 64.0) * specMask * dayW;
    color += glint * vec3(1.0, 0.96, 0.88);
    float lx = abs(fract(vUv.x * 18.0 + 0.5) - 0.5);
    float ly = abs(fract(vUv.y * 9.0 + 0.5) - 0.5);
    float d = min(lx, ly);
    float aa = max(fwidth(d), 0.002);
    float line = 1.0 - smoothstep(aa, aa * 2.4, d);
    color = mix(color, vec3(0.78, 0.86, 0.82), line * uGraticule);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const CLOUD_FRAG = `
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec2 uv = vUv;
    uv.x += 0.25;
    float a = texture2D(cloudMap, uv).r;
    float ndl = dot(normalize(vNormal), normalize(sunDir));
    float light = 0.42 + 0.7 * max(ndl, 0.0);
    float shade = smoothstep(-0.25, 0.2, ndl);
    gl_FragColor = vec4(vec3(0.94, 0.95, 0.96) * light, a * uOpacity * shade);
  }
`;

const ATMO_VERT = `
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMO_FRAG = `
  uniform vec3 sunDir;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    float fres = pow(0.68 - dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 3.4);
    float sun = pow(max(dot(normalize(vWorld), normalize(sunDir)), 0.0), 2.2);
    vec3 col = mix(vec3(0.28, 0.52, 0.98), vec3(1.0, 0.74, 0.46), sun);
    gl_FragColor = vec4(col, clamp(fres, 0.0, 1.0) * 0.95);
  }
`;

function latLon(lat, lon, radius, out) {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  out.set(radius * c * Math.sin(lo), radius * Math.sin(la), radius * c * Math.cos(lo));
  return out;
}

function placeholder(r, g, b) {
  const data = new Uint8Array([r, g, b, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

async function loadMap(url, anisotropy) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Texture failed " + url);
  const blob = await res.blob();
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: "flipY", colorSpaceConversion: "none" });
  } catch {
    bmp = await createImageBitmap(blob, { imageOrientation: "flipY" });
  }
  const tex = new THREE.Texture(bmp);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = anisotropy;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function ringLine(lat, lon, angular, segments, lift, color) {
  const center = new THREE.Vector3();
  latLon(lat, lon, 1, center);
  const n = center.clone().normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(n, east).normalize();
  const pts = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const p = n.clone()
      .addScaledVector(east, Math.cos(a) * angular)
      .addScaledVector(north, Math.sin(a) * angular)
      .normalize()
      .multiplyScalar(lift);
    pts.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return line;
}

function surfacePoint(lat, lon, eastAng, northAng, lift, out) {
  const center = _center;
  latLon(lat, lon, 1, center);
  const n = _n.copy(center).normalize();
  const east = _east.crossVectors(_up, n);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = _north.crossVectors(n, east).normalize();
  out.copy(n).addScaledVector(east, eastAng).addScaledVector(north, northAng).normalize().multiplyScalar(lift);
  return out;
}

const _center = new THREE.Vector3();
const _n = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();

const INDUSTRIES = ["defense", "agriculture", "construction", "weather", "energy", "maritime"];

export function createEarth(scene, renderer, { mobile, hiRes }) {
  const group = new THREE.Group();
  group.name = "earth";
  scene.add(group);

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const segs = mobile ? [48, 32] : [96, 64];
  const uniforms = {
    dayMap: { value: placeholder(12, 40, 72) },
    nightMap: { value: placeholder(0, 0, 0) },
    specMap: { value: placeholder(0, 0, 0) },
    bumpMap: { value: placeholder(128, 128, 128) },
    sunDir: { value: new THREE.Vector3(1, 0.2, 0.4) },
    hasDay: { value: 0 },
    hasNight: { value: 0 },
    hasSpec: { value: 0 },
    hasBump: { value: 0 },
    uDetail: { value: 0 },
    uGraticule: { value: 0 },
  };

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, segs[0], segs[1]),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: EARTH_FRAG,
      toneMapped: false,
    }),
  );
  group.add(surface);

  const cloudUniforms = {
    cloudMap: { value: placeholder(0, 0, 0) },
    sunDir: uniforms.sunDir,
    uOpacity: { value: 0.62 },
  };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.012, segs[0], segs[1]),
    new THREE.ShaderMaterial({
      uniforms: cloudUniforms,
      vertexShader: VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  clouds.renderOrder = 2;
  group.add(clouds);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.055, segs[0], segs[1]),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: uniforms.sunDir },
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  atmo.renderOrder = 3;
  group.add(atmo);

  const overlays = buildOverlays();
  group.add(overlays.root);

  const weights = Object.fromEntries(INDUSTRIES.map((id) => [id, 0]));
  let spin = 0;
  let cloudSpin = 0;

  const ready = (async () => {
    const dayName = hiRes ? "earth-day-4k.webp" : "earth-day-2k.webp";
    const nightName = hiRes ? "earth-night-4k.webp" : "earth-night-2k.webp";
    const queue = [
      [dayName, "dayMap", "hasDay"],
      [nightName, "nightMap", "hasNight"],
      ["earth-bump-2k.webp", "bumpMap", "hasBump"],
      ["earth-spec-2k.webp", "specMap", "hasSpec"],
      ["earth-clouds-2k.webp", null, null],
    ];
    for (const [file, key, flag] of queue) {
      const tex = await loadMap("/textures/" + file, anisotropy);
      if (key) {
        uniforms[key].value = tex;
        uniforms[flag].value = 1;
      } else {
        cloudUniforms.cloudMap.value = tex;
      }
      await nextFrame();
    }
  })();

  function update(dt, camera, sun, focus, reduced) {
    uniforms.sunDir.value.copy(sun);
    const alt = camera.position.length();
    const near = 1 - smoothstep(1.22, 1.72, alt);
    uniforms.uDetail.value = near;
    uniforms.uGraticule.value = smoothstep(2.15, 1.28, alt) * 0.28;
    const cloudGoal = (focus.cloud == null ? 1 : focus.cloud) * smoothstep(1.28, 1.9, alt);
    cloudUniforms.uOpacity.value = reduced ? cloudGoal : cloudUniforms.uOpacity.value + (cloudGoal - cloudUniforms.uOpacity.value) * (1 - Math.exp(-4 * dt));
    if (!reduced) {
      cloudSpin += dt * 0.012;
      clouds.rotation.y = cloudSpin;
      if (weights.weather > 0.05) spin += dt * 0.28;
      if (weights.maritime > 0.05) overlays.tickMaritime(dt);
    }
    overlays.spin.rotation.y = spin;
    const active = focus.industry || "";
    INDUSTRIES.forEach((id) => {
      const goal = id === active ? 1 : 0;
      weights[id] = reduced ? goal : weights[id] + (goal - weights[id]) * (1 - Math.exp(-7 * dt));
      const node = overlays.nodes[id];
      node.visible = weights[id] > 0.03;
      overlays.setOpacity(id, Math.min(1, weights[id]));
    });
    if (weights.defense > 0.03 && focus.sat) overlays.updateLink(focus.sat);
  }

  return { group, clouds, update, ready, weights };
}

function buildOverlays() {
  const root = new THREE.Group();
  root.name = "telemetry";
  const nodes = {};
  const materials = [];

  const bone = 0xd9d2c5;
  const green = 0x7ea35a;
  const amber = 0xc4a15a;
  const signal = 0xd86a3a;

  function add(id, node) {
    node.visible = false;
    node.traverse((obj) => {
      if (obj.material) {
        obj.material.transparent = true;
        obj.material.depthWrite = false;
        materials.push([id, obj.material]);
      }
    });
    nodes[id] = node;
    root.add(node);
  }

  const defense = new THREE.Group();
  defense.add(ringLine(35.95, -5.6, 0.085, 72, 1.006, bone));
  defense.add(ringLine(35.95, -5.6, 0.045, 48, 1.008, signal));
  const linkGeo = new THREE.BufferGeometry();
  const linkArr = new Float32Array(36 * 3);
  linkGeo.setAttribute("position", new THREE.BufferAttribute(linkArr, 3));
  const link = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: bone, transparent: true }));
  link.frustumCulled = false;
  defense.add(link);
  add("defense", defense);

  const agriculture = new THREE.Group();
  const parcelGeo = new THREE.PlaneGeometry(0.016, 0.012);
  const parcelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide });
  const parcels = new THREE.InstancedMesh(parcelGeo, parcelMat, 48);
  const dummy = new THREE.Object3D();
  const palette = [0x6f4b2d, 0xa4833c, 0xc6b15a, 0x8eab52, 0x4f8a45, 0x1f5a38];
  let n = 0;
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      surfacePoint(36.6, -119.7, (col - 3.5) * 0.009, (row - 2.5) * 0.007, 1.008, dummy.position);
      dummy.lookAt(dummy.position.x * 2, dummy.position.y * 2, dummy.position.z * 2);
      dummy.updateMatrix();
      parcels.setMatrixAt(n, dummy.matrix);
      parcels.setColorAt(n, new THREE.Color(palette[(row * 3 + col) % palette.length]));
      n += 1;
    }
  }
  parcels.instanceMatrix.needsUpdate = true;
  if (parcels.instanceColor) parcels.instanceColor.needsUpdate = true;
  agriculture.add(parcels);
  add("agriculture", agriculture);

  const construction = new THREE.Group();
  construction.add(ringLine(36.9, -76.1, 0.05, 64, 1.006, bone));
  construction.add(ringLine(36.9, -76.1, 0.09, 72, 1.005, 0x8d9288));
  construction.add(ringLine(36.9, -76.1, 0.13, 80, 1.004, 0x6e756c));
  const poly = [];
  [[0.02, 0.01], [0.05, 0.02], [0.045, -0.02], [0.01, -0.03], [-0.02, -0.01], [-0.01, 0.02]].forEach((pair, i, arr) => {
    surfacePoint(36.9, -76.1, pair[0], pair[1], 1.009, _p);
    poly.push(_p.clone());
    if (i === arr.length - 1) {
      surfacePoint(36.9, -76.1, arr[0][0], arr[0][1], 1.009, _p);
      poly.push(_p.clone());
    }
  });
  construction.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(poly),
    new THREE.LineBasicMaterial({ color: signal, transparent: true }),
  ));
  add("construction", construction);

  const weather = new THREE.Group();
  latLon(28, -68, 1.01, weather.position);
  weather.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), weather.position.clone().normalize());
  const spin = new THREE.Group();
  weather.add(spin);
  [0.04, 0.07, 0.1].forEach((radius, index) => {
    const pts = [];
    const turns = 5.2 + index;
    for (let i = 0; i <= 80; i += 1) {
      const a = (i / 80) * Math.PI * turns;
      const rr = radius * (0.35 + 0.65 * (i / 80));
      pts.push(new THREE.Vector3(Math.cos(a) * rr, 0.012, Math.sin(a) * rr));
    }
    spin.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: index === 2 ? 0xfff6ea : 0xf4efe4, transparent: true }),
    ));
  });
  spin.add(ringLocal(0.028, signal));
  add("weather", weather);

  const energy = new THREE.Group();
  const corridor = [];
  for (let i = 0; i < 28; i += 1) {
    const t = i / 27;
    latLon(31.7 + t * 1.3, -102.4 + t * 2.4, 1.007, _p);
    corridor.push(_p.clone());
  }
  energy.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(corridor),
    new THREE.LineBasicMaterial({ color: bone, transparent: true }),
  ));
  [0.15, 0.48, 0.78].forEach((t, index) => {
    latLon(31.7 + t * 1.3, -102.4 + t * 2.4, 1.012, _p);
    const mark = new THREE.Mesh(
      new THREE.SphereGeometry(index === 1 ? 0.012 : 0.008, 12, 8),
      new THREE.MeshBasicMaterial({ color: index === 1 ? signal : bone }),
    );
    mark.position.copy(_p);
    energy.add(mark);
  });
  add("energy", energy);

  const maritime = new THREE.Group();
  const lane = [];
  const waypoints = [[2.15, 101.1], [2.45, 101.7], [2.7, 102.35], [3.05, 103.15], [3.35, 103.9]];
  waypoints.forEach(([lat, lon]) => {
    latLon(lat, lon, 1.006, _p);
    lane.push(_p.clone());
  });
  maritime.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(lane),
    new THREE.LineBasicMaterial({ color: bone, transparent: true }),
  ));
  const vessels = [0.18, 0.46, 0.72].map(() => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.004, 0.006),
      new THREE.MeshBasicMaterial({ color: 0xf4f0e8 }),
    );
    maritime.add(mesh);
    return mesh;
  });
  add("maritime", maritime);

  let maritimePhase = 0;
  function tickMaritime(dt) {
    maritimePhase += dt * 0.08;
    vessels.forEach((mesh, index) => {
      const t = (maritimePhase + index * 0.31) % 1;
      const f = t * (lane.length - 1);
      const i = Math.min(lane.length - 2, Math.floor(f));
      _a.copy(lane[i]).lerp(lane[i + 1], f - i);
      mesh.position.copy(_a);
      mesh.lookAt(lane[Math.min(lane.length - 1, i + 1)]);
    });
  }

  function updateLink(sat) {
    latLon(36.15, -5.35, 1.004, _a);
    _b.copy(_a).lerp(sat, 0.5);
    _c.copy(_b).normalize().multiplyScalar(_b.length() + 0.28);
    for (let i = 0; i < 36; i += 1) {
      const t = i / 35;
      const u = 1 - t;
      _p.set(
        u * u * _a.x + 2 * u * t * _c.x + t * t * sat.x,
        u * u * _a.y + 2 * u * t * _c.y + t * t * sat.y,
        u * u * _a.z + 2 * u * t * _c.z + t * t * sat.z,
      );
      linkArr[i * 3] = _p.x;
      linkArr[i * 3 + 1] = _p.y;
      linkArr[i * 3 + 2] = _p.z;
    }
    linkGeo.attributes.position.needsUpdate = true;
  }

  function setOpacity(id, value) {
    materials.forEach(([key, mat]) => {
      if (key === id) mat.opacity = value;
    });
  }

  return { root, nodes, spin, tickMaritime, updateLink, setOpacity };
}

function ringLocal(radius, color) {
  const pts = [];
  for (let i = 0; i <= 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0.014, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true }),
  );
}
