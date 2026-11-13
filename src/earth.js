// Real-time Earth. One WebGL context, drawn only from the page's single rAF.
// Day texture: NASA Blue Marble, public domain, resized to 2048 and recompressed.
// Night texture: city lights isolated from NASA Black Marble, public domain.
// LEO and sun-synchronous radii are to scale (Earth = 1). GEO's true radius is
// about 6.6; it is drawn at 1.72 so the ring fits the frame. The picture's clock
// runs faster than UTC so motion is legible. See orbit.js.

import { LEAD, SATS, orbitPoint, anomaly, sunDirectionInto, visualNow } from "./orbit.js";

const EARTH_VERT = `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vUv = uv;
  vNormal = normalize(uNormalMatrix * position);
  vec4 mv = uModelView * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = uProjection * mv;
}
`;

const EARTH_FRAG = `
precision highp float;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform vec3 uSun;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  vec3 s = normalize(uSun);
  vec3 viewDir = normalize(-vView);
  float ndl = dot(n, s);
  float dayW = smoothstep(-0.12, 0.32, ndl);
  vec3 day = texture2D(uDay, vUv).rgb;
  day = pow(max(day, 0.0), vec3(0.96));
  vec3 lights = texture2D(uNight, vUv).rgb;
  vec3 color = mix(vec3(0.004, 0.006, 0.014), day, dayW);
  color += lights * (1.0 - dayW) * 1.15;
  float band = exp(-ndl * ndl * 22.0);
  color += vec3(0.72, 0.28, 0.08) * band * 0.22;
  float ocean = smoothstep(0.02, 0.2, day.b - day.r);
  vec3 halfVec = normalize(s + viewDir);
  float spec = pow(max(dot(n, halfVec), 0.0), 72.0) * ocean * dayW;
  color += spec * vec3(0.85, 0.9, 0.95) * 0.32;
  float ndv = max(dot(n, viewDir), 0.0);
  color *= mix(0.62, 1.0, smoothstep(0.0, 0.5, ndv));
  gl_FragColor = vec4(color, 1.0);
}
`;

const ATMO_VERT = `
attribute vec3 position;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(uNormalMatrix * position);
  vec4 mv = uModelView * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = uProjection * mv;
}
`;

const ATMO_FRAG = `
precision highp float;
uniform vec3 uSun;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  vec3 s = normalize(uSun);
  vec3 viewDir = normalize(-vView);
  float ndv = max(dot(n, viewDir), 0.0);
  float fres = pow(1.0 - ndv, 2.7);
  float daySide = smoothstep(-0.2, 0.45, dot(n, s));
  vec3 col = vec3(0.34, 0.52, 0.72) * fres;
  col += vec3(0.95, 0.55, 0.26) * pow(fres, 3.2) * daySide;
  gl_FragColor = vec4(col * 0.95, 1.0);
}
`;

const LINE_VERT = `
attribute vec3 position;
uniform mat4 uMvp;
void main() {
  gl_Position = uMvp * vec4(position, 1.0);
}
`;

const LINE_FRAG = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }
`;

const POINT_VERT = `
attribute vec3 position;
uniform mat4 uMvp;
uniform float uSize;
void main() {
  gl_Position = uMvp * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`;

const POINT_FRAG = `
precision mediump float;
uniform vec4 uColor;
uniform float uSquare;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (uSquare > 0.5) {
    if (max(abs(c.x), abs(c.y)) > 0.72) discard;
  } else if (dot(c, c) > 1.0) {
    discard;
  }
  gl_FragColor = uColor;
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "Shader failed");
  }
  return shader;
}

function program(gl, vert, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "Program failed");
  }
  return p;
}

function identity(o) {
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}

function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
  return out;
}

function lookAt(out, eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-6) {
    identity(out);
    return out;
  }
  xx /= len; xy /= len; xz /= len;
  let yx = zy * xz - zz * xy;
  let yy = zz * xx - zx * xz;
  let yz = zx * xy - zy * xx;
  len = Math.hypot(yx, yy, yz) || 1;
  yx /= len; yy /= len; yz /= len;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function mat3Into(m4, out) {
  out[0] = m4[0]; out[1] = m4[1]; out[2] = m4[2];
  out[3] = m4[4]; out[4] = m4[5]; out[5] = m4[6];
  out[6] = m4[8]; out[7] = m4[9]; out[8] = m4[10];
  return out;
}

function dirInto(m, v, out) {
  out[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
  out[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
  out[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
  return out;
}

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smooth(t) {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildSphere(stacks, slices) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let y = 0; y <= stacks; y++) {
    const v = y / stacks;
    const theta = v * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let x = 0; x <= slices; x++) {
      const u = x / slices;
      // Match a geographic frame: lon 0 (u = 0.5) faces +Z.
      const lon = (u - 0.5) * Math.PI * 2;
      positions.push(sinT * Math.sin(lon), cosT, sinT * Math.cos(lon));
      uvs.push(u, 1 - v);
    }
  }
  for (let y = 0; y < stacks; y++) {
    for (let x = 0; x < slices; x++) {
      const a = y * (slices + 1) + x;
      const b = a + slices + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

function orbitLine(sat, segments) {
  const data = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const nu = (i / segments) * Math.PI * 2;
    const p = orbitPoint(sat.radius, sat.inc, sat.raan, nu);
    data[i * 3] = p[0];
    data[i * 3 + 1] = p[1];
    data[i * 3 + 2] = p[2];
  }
  return data;
}

function loadBlob(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error("Texture missing");
    return res.blob();
  });
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function uploadTexture(gl, bitmap, unit) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bitmap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
  }
  bitmap.close?.();
  return tex;
}

function sphEye(dist, az, el, target, out) {
  const ce = Math.cos(el);
  out[0] = target[0] + dist * ce * Math.sin(az);
  out[1] = target[1] + dist * Math.sin(el);
  out[2] = target[2] + dist * ce * Math.cos(az);
  return out;
}

function lerp3(out, a, b, t) {
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

const poseOut = { eye: [0, 0, 5], target: [0, 0, 0], radius: 5 };
const camSun = [0, 0, 1];
const heroEye = [0, 0, 5];
const heroTarget = [0, 0, 0];
const chaseEye = [0, 0, 5];
const chaseTarget = [0, 0, 0];
const endEye = [0, 0, 5];
const endTarget = [0, 0, 0];
const satNow = [0, 0, 0];
const satAhead = [0, 0, 0];
const pointScratch = [0, 0, 0];
const normalMat = new Float32Array(9);
const atmoNormal = new Float32Array(9);
const sunView = new Float32Array(3);
const upAxis = [0, 1, 0];
const altUp = [0, 0, 1];

function pose(scrollY, layout, mobile, ms) {
  sunDirectionInto(ms, camSun);
  const sun = camSun;
  const sunAz = Math.atan2(sun[0], sun[2]);
  const heroH = Math.max(1, layout.hero.height);
  const heroP = smooth(clamp01(scrollY / heroH));
  const ind = layout.industries;
  const indP = clamp01((scrollY - ind.top) / Math.max(1, ind.height));
  const brief = layout.briefing;
  const closeP = clamp01((scrollY - brief.top) / Math.max(1, brief.height));

  if (mobile) {
    const dist = lerp(6.9, 6.15, heroP);
    const el = 0.22;
    const az = sunAz + 0.35;
    if (scrollY > brief.top - layout.vh * 0.2) {
      poseOut.target[0] = 0;
      poseOut.target[1] = -0.2;
      poseOut.target[2] = 0;
      sphEye(6.4, sunAz + 0.2, 0.26, poseOut.target, poseOut.eye);
      poseOut.radius = 6.4;
      return poseOut;
    }
    poseOut.target[0] = 0;
    poseOut.target[1] = -0.55;
    poseOut.target[2] = 0;
    sphEye(dist, az, el, poseOut.target, poseOut.eye);
    poseOut.radius = dist;
    return poseOut;
  }

  const heroDist = lerp(6.05, 3.35, heroP);
  const heroEl = lerp(0.36, 0.16, heroP);
  const heroAz = sunAz + lerp(1.05, 0.62, heroP);
  heroTarget[0] = lerp(-1.15, -0.4, heroP);
  heroTarget[1] = lerp(-0.08, 0.04, heroP);
  heroTarget[2] = 0;
  sphEye(heroDist, heroAz, heroEl, heroTarget, heroEye);

  const nu = anomaly(LEAD, ms);
  orbitPoint(LEAD.radius, LEAD.inc, LEAD.raan, nu, satNow);
  orbitPoint(LEAD.radius, LEAD.inc, LEAD.raan, nu + 0.35, satAhead);
  const sl = Math.hypot(satNow[0], satNow[1], satNow[2]) || 1;
  const rx = satNow[0] / sl;
  const ry = satNow[1] / sl;
  const rz = satNow[2] / sl;
  let vx = satAhead[0] - satNow[0];
  let vy = satAhead[1] - satNow[1];
  let vz = satAhead[2] - satNow[2];
  const vl = Math.hypot(vx, vy, vz) || 1;
  vx /= vl; vy /= vl; vz /= vl;
  const chaseT = smooth(clamp01((indP - 0.08) / 0.92));
  const alt = lerp(3.15, 1.28, chaseT);
  const side = lerp(0.72, 0.18, chaseT);
  chaseEye[0] = rx * alt - vx * side;
  chaseEye[1] = ry * alt - vy * side + lerp(0.38, 0.06, chaseT);
  chaseEye[2] = rz * alt - vz * side;
  let elen = Math.hypot(chaseEye[0], chaseEye[1], chaseEye[2]) || 1;
  const minR = lerp(1.9, 1.16, chaseT);
  if (elen < minR) {
    chaseEye[0] = chaseEye[0] / elen * minR;
    chaseEye[1] = chaseEye[1] / elen * minR;
    chaseEye[2] = chaseEye[2] / elen * minR;
  }
  const look = smooth(clamp01((chaseT - 0.35) / 0.65));
  chaseTarget[0] = rx * look * 0.94;
  chaseTarget[1] = ry * look * 0.94;
  chaseTarget[2] = rz * look * 0.94;

  let blend = 0;
  if (scrollY + layout.vh * 0.35 >= ind.top && scrollY < brief.top) {
    blend = smooth(clamp01(indP / 0.16));
  } else if (scrollY >= brief.top) {
    blend = 1;
  }
  lerp3(poseOut.eye, heroEye, chaseEye, blend);
  lerp3(poseOut.target, heroTarget, chaseTarget, blend);

  if (scrollY + layout.vh * 0.15 > brief.top) {
    const pull = smooth(closeP);
    const endDist = lerp(3.3, 5.1, pull);
    endTarget[0] = lerp(-0.2, 0, pull);
    endTarget[1] = 0.05;
    endTarget[2] = 0;
    sphEye(endDist, sunAz + 0.4, lerp(0.22, 0.3, pull), endTarget, endEye);
    const mixedR = Math.hypot(poseOut.eye[0], poseOut.eye[1], poseOut.eye[2]);
    lerp3(poseOut.eye, poseOut.eye, endEye, pull);
    lerp3(poseOut.target, poseOut.target, endTarget, pull);
    poseOut.radius = mixedR + (endDist - mixedR) * pull;
    return poseOut;
  }

  poseOut.radius = Math.hypot(poseOut.eye[0], poseOut.eye[1], poseOut.eye[2]);
  return poseOut;
}

export function createEarth(canvas, options) {
  const onRestored = options && options.onRestored;
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: !mobileQuery.matches,
    depth: true,
    stencil: false,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false,
  });
  if (!gl) return Promise.reject(new Error("WebGL unavailable"));

  const api = {
    lost: false,
    draw() {},
    resize() {},
  };
  let rebuilding = false;

  function adopt(impl) {
    api.lost = false;
    api.draw = (state) => {
      if (api.lost) return;
      impl.draw(state);
    };
    api.resize = () => {
      if (api.lost) return;
      impl.resize();
    };
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    api.lost = true;
    api.draw = () => {};
    api.resize = () => {};
    document.documentElement.classList.add("no-gl");
    canvas.classList.remove("is-on");
  });

  canvas.addEventListener("webglcontextrestored", () => {
    if (rebuilding) return;
    rebuilding = true;
    document.documentElement.classList.remove("no-gl");
    buildScene(gl, canvas, mobileQuery).then((impl) => {
      adopt(impl);
      rebuilding = false;
      canvas.classList.add("is-booting", "is-on");
      impl.resize();
      if (typeof onRestored === "function") onRestored();
    }).catch(() => {
      rebuilding = false;
      document.documentElement.classList.add("no-gl");
      canvas.classList.remove("is-on");
    });
  });

  return buildScene(gl, canvas, mobileQuery).then((impl) => {
    adopt(impl);
    return api;
  });
}

async function buildScene(gl, canvas, mobileQuery) {

  const earthProg = program(gl, EARTH_VERT, EARTH_FRAG);
  const atmoProg = program(gl, ATMO_VERT, ATMO_FRAG);
  const lineProg = program(gl, LINE_VERT, LINE_FRAG);
  const pointProg = program(gl, POINT_VERT, POINT_FRAG);

  const sphere = buildSphere(64, 96);
  const sphereBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.uvs, gl.STATIC_DRAW);
  const indexBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);

  const lineGeo = SATS.map((sat) => {
    const data = orbitLine(sat, sat.kind === "geo" ? 256 : 192);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const color = sat.kind === "geo" ? [0.90, 0.88, 0.82, 0.28]
      : sat.kind === "sso" ? [0.90, 0.88, 0.82, 0.42]
      : [0.90, 0.88, 0.82, 0.62];
    return { buf, count: data.length / 3, color };
  });

  const pointBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(SATS.length * 3), gl.DYNAMIC_DRAW);

  const mobileNow = mobileQuery.matches;
  const dayUrl = mobileNow ? "/textures/earth-day-1024.webp" : "/textures/earth-day.webp";
  const nightUrl = mobileNow ? "/textures/earth-night-1024.webp" : "/textures/earth-night.webp";
  const [dayBlob, nightBlob] = await Promise.all([loadBlob(dayUrl), loadBlob(nightUrl)]);
  const dayBmp = await createImageBitmap(dayBlob, { imageOrientation: "flipY" });
  await nextFrame();
  uploadTexture(gl, dayBmp, 0);
  const nightBmp = await createImageBitmap(nightBlob, { imageOrientation: "flipY" });
  await nextFrame();
  uploadTexture(gl, nightBmp, 1);

  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const model = new Float32Array(16);
  const modelView = new Float32Array(16);
  const mvp = new Float32Array(16);
  const atmoModel = new Float32Array([
    1.045, 0, 0, 0,
    0, 1.045, 0, 0,
    0, 0, 1.045, 0,
    0, 0, 0, 1,
  ]);
  const atmoMV = new Float32Array(16);
  const points = new Float32Array(SATS.length * 3);
  identity(model);

  const earthLoc = {
    pos: gl.getAttribLocation(earthProg, "position"),
    uv: gl.getAttribLocation(earthProg, "uv"),
    mv: gl.getUniformLocation(earthProg, "uModelView"),
    proj: gl.getUniformLocation(earthProg, "uProjection"),
    normal: gl.getUniformLocation(earthProg, "uNormalMatrix"),
    sun: gl.getUniformLocation(earthProg, "uSun"),
    day: gl.getUniformLocation(earthProg, "uDay"),
    night: gl.getUniformLocation(earthProg, "uNight"),
  };
  const atmoLoc = {
    pos: gl.getAttribLocation(atmoProg, "position"),
    mv: gl.getUniformLocation(atmoProg, "uModelView"),
    proj: gl.getUniformLocation(atmoProg, "uProjection"),
    normal: gl.getUniformLocation(atmoProg, "uNormalMatrix"),
    sun: gl.getUniformLocation(atmoProg, "uSun"),
  };
  const lineLoc = {
    pos: gl.getAttribLocation(lineProg, "position"),
    mvp: gl.getUniformLocation(lineProg, "uMvp"),
    color: gl.getUniformLocation(lineProg, "uColor"),
  };
  const pointLoc = {
    pos: gl.getAttribLocation(pointProg, "position"),
    mvp: gl.getUniformLocation(pointProg, "uMvp"),
    color: gl.getUniformLocation(pointProg, "uColor"),
    size: gl.getUniformLocation(pointProg, "uSize"),
    square: gl.getUniformLocation(pointProg, "uSquare"),
  };

  let dpr = 1;
  let width = 1;
  let height = 1;
  const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  const maxPoint = pointRange ? pointRange[1] : 32;

  function resize() {
    const mobile = mobileQuery.matches;
    dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    width = w;
    height = h;
    gl.viewport(0, 0, w, h);
  }

  function bindSphere(posLoc, uvLoc) {
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    if (uvLoc >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
  }

  resize();

  function draw(state) {
    if (!state.layout) return;
    const mobile = mobileQuery.matches;
    const ms = visualNow(state.now, state.reduced);
    const cam = state.reduced
      ? pose(state.layout.hero.height * 0.28, state.layout, mobile, ms)
      : pose(state.scrollY, state.layout, mobile, ms);
    const aspect = width / Math.max(1, height);
    const fov = (mobile ? 34 : 28) * Math.PI / 180;
    perspective(proj, fov, aspect, 0.02, 40);
    const upDot = Math.abs(cam.eye[1] - cam.target[1]) / (Math.hypot(
      cam.eye[0] - cam.target[0],
      cam.eye[1] - cam.target[1],
      cam.eye[2] - cam.target[2],
    ) || 1);
    lookAt(view, cam.eye, cam.target, upDot > 0.92 ? altUp : upAxis);
    multiply(modelView, view, model);
    multiply(mvp, proj, modelView);
    sunDirectionInto(ms, camSun);
    dirInto(view, camSun, sunView);
    mat3Into(modelView, normalMat);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0.047, 0.047, 0.043, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(earthProg);
    bindSphere(earthLoc.pos, earthLoc.uv);
    gl.uniformMatrix4fv(earthLoc.mv, false, modelView);
    gl.uniformMatrix4fv(earthLoc.proj, false, proj);
    gl.uniformMatrix3fv(earthLoc.normal, false, normalMat);
    gl.uniform3fv(earthLoc.sun, sunView);
    gl.uniform1i(earthLoc.day, 0);
    gl.uniform1i(earthLoc.night, 1);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.drawElements(gl.TRIANGLES, sphere.indices.length, gl.UNSIGNED_SHORT, 0);

    multiply(atmoMV, view, atmoModel);
    gl.useProgram(atmoProg);
    bindSphere(atmoLoc.pos, -1);
    gl.uniformMatrix4fv(atmoLoc.mv, false, atmoMV);
    gl.uniformMatrix4fv(atmoLoc.proj, false, proj);
    gl.uniformMatrix3fv(atmoLoc.normal, false, mat3Into(atmoMV, atmoNormal));
    gl.uniform3fv(atmoLoc.sun, sunView);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, sphere.indices.length, gl.UNSIGNED_SHORT, 0);

    const fade = clamp01((cam.radius - 1.35) / 1.6);
    gl.useProgram(lineProg);
    gl.uniformMatrix4fv(lineLoc.mvp, false, mvp);
    gl.enableVertexAttribArray(lineLoc.pos);
    for (const line of lineGeo) {
      gl.bindBuffer(gl.ARRAY_BUFFER, line.buf);
      gl.vertexAttribPointer(lineLoc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(lineLoc.color, line.color[0], line.color[1], line.color[2], line.color[3] * fade);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.LINE_STRIP, 0, line.count);
    }

    for (let i = 0; i < SATS.length; i++) {
      const sat = SATS[i];
      orbitPoint(sat.radius, sat.inc, sat.raan, anomaly(sat, ms), pointScratch);
      points[i * 3] = pointScratch[0];
      points[i * 3 + 1] = pointScratch[1];
      points[i * 3 + 2] = pointScratch[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, points);
    gl.useProgram(pointProg);
    gl.uniformMatrix4fv(pointLoc.mvp, false, mvp);
    gl.enableVertexAttribArray(pointLoc.pos);
    gl.vertexAttribPointer(pointLoc.pos, 3, gl.FLOAT, false, 0, 0);
    gl.uniform4f(pointLoc.color, 0.90, 0.88, 0.82, fade);
    gl.uniform1f(pointLoc.size, Math.min(maxPoint, 6.0 * dpr));
    gl.uniform1f(pointLoc.square, 0);
    gl.drawArrays(gl.POINTS, 1, SATS.length - 1);
    gl.uniform4f(pointLoc.color, 1.0, 0.31, 0.12, Math.max(0.35, fade));
    gl.uniform1f(pointLoc.size, Math.min(maxPoint, 9.0 * dpr));
    gl.uniform1f(pointLoc.square, 1);
    gl.drawArrays(gl.POINTS, 0, 1);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  return { draw, resize };
}
