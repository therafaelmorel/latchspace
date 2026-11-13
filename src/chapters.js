// Stylized instrument plates. Geometry is built once; a frame only repaints
// the plate that is actually on screen. Nothing here is a measured product.

const INK = "#e6e0d4";
const DIM = "rgba(230, 224, 212, 0.62)";
const FAINT = "rgba(230, 224, 212, 0.22)";
const GRID = "rgba(230, 224, 212, 0.07)";
const ACCENT = "#ff4f1f";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function subdivide(x, y, w, h, depth, rand, out) {
  const stop = depth <= 0 || w < 36 || h < 32 || (depth < 3 && rand() < 0.28);
  if (stop) {
    out.push({ x, y, w, h, v: rand() });
    return;
  }
  if (w > h) {
    const s = w * (0.38 + rand() * 0.24);
    subdivide(x, y, s, h, depth - 1, rand, out);
    subdivide(x + s, y, w - s, h, depth - 1, rand, out);
  } else {
    const s = h * (0.38 + rand() * 0.24);
    subdivide(x, y, w, s, depth - 1, rand, out);
    subdivide(x, y + s, w, h - s, depth - 1, rand, out);
  }
}

function ndviColor(v) {
  const stops = [
    [92, 64, 42],
    [154, 132, 64],
    [116, 138, 58],
    [36, 92, 58],
  ];
  const x = Math.min(0.999, Math.max(0, v)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  const c = a.map((n, k) => Math.round(n + (b[k] - n) * f));
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

function ticks(ctx, w, h) {
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  const m = 10;
  const len = 8;
  ctx.beginPath();
  ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m);
  ctx.moveTo(w - m - len, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + len);
  ctx.moveTo(m, h - m - len); ctx.lineTo(m, h - m); ctx.lineTo(m + len, h - m);
  ctx.moveTo(w - m, h - m - len); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m - len, h - m);
  ctx.stroke();
}

function label(ctx, text, x, y, color = DIM) {
  ctx.fillStyle = color;
  ctx.font = "500 11px Inter";
  ctx.letterSpacing = "0.12em";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

function drawDefense(ctx, w, h, t) {
  ctx.fillStyle = "#10100e";
  ctx.fillRect(0, 0, w, h);
  ticks(ctx, w, h);
  const nodes = [
    { x: w * 0.22, y: h * 0.7, name: "GROUND" },
    { x: w * 0.5, y: h * 0.28, name: "SPACECRAFT" },
    { x: w * 0.78, y: h * 0.64, name: "TERMINAL" },
  ];
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  nodes[1] && ctx.beginPath();
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(nodes[1].x, nodes[1].y, 28 + i * 22, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = DIM;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  ctx.lineTo(nodes[1].x, nodes[1].y);
  ctx.lineTo(nodes[2].x, nodes[2].y);
  ctx.stroke();
  ctx.setLineDash([]);
  const links = [
    [nodes[0], nodes[1]],
    [nodes[1], nodes[2]],
  ];
  links.forEach((pair, index) => {
    const u = (t * 0.18 + index * 0.37) % 1;
    const x = pair[0].x + (pair[1].x - pair[0].x) * u;
    const y = pair[0].y + (pair[1].y - pair[0].y) * u;
    ctx.fillStyle = index === 0 ? ACCENT : INK;
    ctx.fillRect(x - 3, y - 3, 6, 6);
  });
  const midX = (nodes[1].x + nodes[2].x) / 2;
  const midY = (nodes[1].y + nodes[2].y) / 2;
  ctx.strokeStyle = ACCENT;
  ctx.strokeRect(midX - 16, midY - 8, 32, 16);
  label(ctx, "KEY", midX - 10, midY + 4, ACCENT);
  const places = [
    { node: nodes[0], dx: -22, dy: 28 },
    { node: nodes[1], dx: -42, dy: -16 },
    { node: nodes[2], dx: -18, dy: 28 },
  ];
  places.forEach(({ node, dx, dy }) => {
    ctx.strokeStyle = INK;
    ctx.strokeRect(node.x - 5, node.y - 5, 10, 10);
    label(ctx, node.name, node.x + dx, node.y + dy);
  });
  label(ctx, "SCOPED LINK", 16, h - 16);
}

function drawAgriculture(ctx, w, h, t, plate) {
  if (!plate.parcels || plate.builtFor !== w + "x" + h) {
    const rand = mulberry32(19);
    const parcels = [];
    subdivide(16, 16, w - 32, h - 64, 5, rand, parcels);
    let tasked = 0;
    parcels.forEach((p, i) => {
      if (Math.abs(p.v - 0.62) < Math.abs(parcels[tasked].v - 0.62)) tasked = i;
      p.color = ndviColor(p.v);
    });
    plate.parcels = parcels;
    plate.tasked = tasked;
    plate.builtFor = w + "x" + h;
  }
  ctx.fillStyle = "#14110e";
  ctx.fillRect(0, 0, w, h);
  plate.parcels.forEach((p) => {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
  });
  const task = plate.parcels[plate.tasked];
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(task.x + 0.5, task.y + 0.5, task.w - 1, task.h - 1);
  ctx.fillStyle = "#14110e";
  ctx.fillRect(task.x + 6, task.y + 6, 58, 16);
  label(ctx, "TASKED", task.x + 10, task.y + 18, ACCENT);
  const scan = 16 + ((t * 28) % (h - 48));
  ctx.strokeStyle = "rgba(230,224,212,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, scan);
  ctx.lineTo(w - 12, scan);
  ctx.stroke();
  const legendX = 16;
  const legendY = h - 28;
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = ndviColor(i / 79);
    ctx.fillRect(legendX + i, legendY, 1, 8);
  }
  label(ctx, "LOW", legendX, h - 8);
  ctx.textAlign = "right";
  label(ctx, "HIGH", legendX + 80, h - 8);
  ctx.textAlign = "left";
}

function drawConstruction(ctx, w, h, t) {
  ctx.fillStyle = "#10100e";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 24; x < w; x += 24) {
    ctx.moveTo(x, 16);
    ctx.lineTo(x, h - 16);
  }
  for (let y = 24; y < h; y += 24) {
    ctx.moveTo(16, y);
    ctx.lineTo(w - 16, y);
  }
  ctx.stroke();
  ctx.strokeStyle = DIM;
  ctx.beginPath();
  ctx.moveTo(20, h * 0.42);
  ctx.lineTo(w - 20, h * 0.48);
  ctx.moveTo(w * 0.38, 20);
  ctx.lineTo(w * 0.46, h - 20);
  ctx.stroke();
  const prior = [
    [0.14, 0.16, 0.16, 0.12],
    [0.18, 0.62, 0.2, 0.14],
    [0.58, 0.18, 0.18, 0.1],
    [0.62, 0.58, 0.22, 0.16],
    [0.4, 0.38, 0.12, 0.1],
  ];
  const next = [
    [0.36, 0.2, 0.1, 0.14],
    [0.7, 0.34, 0.14, 0.12],
    [0.48, 0.7, 0.16, 0.1],
  ];
  prior.forEach(([x, y, bw, bh]) => {
    ctx.strokeStyle = INK;
    ctx.strokeRect(x * w, y * h, bw * w, bh * h);
  });
  const sweep = (t * 0.12) % 1;
  next.forEach(([x, y, bw, bh], i) => {
    const px = x * w;
    const py = y * h;
    const pw = bw * w;
    const ph = bh * h;
    ctx.fillStyle = "rgba(255, 79, 31, 0.78)";
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = ACCENT;
    ctx.strokeRect(px, py, pw, ph);
    if (i === Math.floor(sweep * next.length)) {
      label(ctx, "NEW", px + 4, py + 14, "#1a100c");
    }
  });
  label(ctx, "PRIOR OUTLINE  /  NEW FILL", 16, h - 16);
}

function wobbleEllipse(ctx, cx, cy, rx, ry, phase) {
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const n = 1 + Math.sin(a * 3 + phase) * 0.06 + Math.cos(a * 2 - phase) * 0.04;
    const x = cx + Math.cos(a) * rx * n;
    const y = cy + Math.sin(a) * ry * n;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawWeather(ctx, w, h, t) {
  ctx.fillStyle = "#10100e";
  ctx.fillRect(0, 0, w, h);
  ticks(ctx, w, h);
  ctx.fillStyle = "rgba(230,224,212,0.05)";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.18);
  ctx.lineTo(w * 0.22, h * 0.22);
  ctx.lineTo(w * 0.16, h * 0.48);
  ctx.lineTo(w * 0.28, h * 0.7);
  ctx.lineTo(w * 0.12, h * 0.92);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = FAINT;
  ctx.stroke();
  const cx = w * 0.6;
  const cy = h * 0.48;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    ctx.strokeStyle = i === 4 ? DIM : FAINT;
    wobbleEllipse(ctx, cx, cy, 28 + i * 28, 18 + i * 20, i);
  }
  ctx.strokeStyle = INK;
  ctx.beginPath();
  for (let i = 0; i <= 220; i++) {
    const u = i / 220;
    const a = u * Math.PI * 5.2 + t * 0.15;
    const r = u * Math.min(w, h) * 0.28;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.72;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = ACCENT;
  ctx.strokeRect(cx - 36, cy - 22, 78, 48);
  label(ctx, "LOW", cx - 12, cy + 4, ACCENT);
  label(ctx, "STYLIZED SYSTEM", 16, h - 16);
}

function drawEnergy(ctx, w, h, t) {
  ctx.fillStyle = "#10100e";
  ctx.fillRect(0, 0, w, h);
  ticks(ctx, w, h);
  const pts = [
    [0.08, 0.78],
    [0.24, 0.62],
    [0.4, 0.66],
    [0.52, 0.42],
    [0.7, 0.36],
    [0.86, 0.18],
  ].map(([x, y]) => [x * w, y * h]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = DIM;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.strokeStyle = FAINT;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const n = pts[Math.min(pts.length - 1, i + 1)];
    const dx = n[0] - p[0];
    const dy = n[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * 5;
    const oy = (dx / len) * 5;
    if (i === 0) ctx.moveTo(p[0] + ox, p[1] + oy);
    else ctx.lineTo(p[0] + ox, p[1] + oy);
  });
  ctx.stroke();
  pts.forEach((p, i) => {
    ctx.strokeStyle = i === 3 ? ACCENT : INK;
    ctx.strokeRect(p[0] - 4, p[1] - 4, 8, 8);
  });
  const u = (t * 0.08) % 1;
  const seg = u * (pts.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = pts[i];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const x = a[0] + (b[0] - a[0]) * f;
  const y = a[1] + (b[1] - a[1]) * f;
  ctx.strokeStyle = ACCENT;
  ctx.strokeRect(x - 18, y - 12, 36, 24);
  label(ctx, "FLAGGED SPAN", pts[3][0] + 10, pts[3][1] - 8, ACCENT);
  label(ctx, "CORRIDOR PASS", 16, h - 16);
}

function drawMaritime(ctx, w, h, t) {
  ctx.fillStyle = "#10100e";
  ctx.fillRect(0, 0, w, h);
  ticks(ctx, w, h);
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    ctx.moveTo(16, (h * i) / 4);
    ctx.lineTo(w - 16, (h * i) / 4);
    ctx.moveTo((w * i) / 4, 16);
    ctx.lineTo((w * i) / 4, h - 16);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(230,224,212,0.06)";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.12);
  ctx.bezierCurveTo(w * 0.18, h * 0.2, w * 0.12, h * 0.46, w * 0.22, h * 0.58);
  ctx.bezierCurveTo(w * 0.1, h * 0.74, w * 0.2, h * 0.88, 0, h * 0.96);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = DIM;
  ctx.stroke();
  const lane = [
    [0.34, 0.16],
    [0.46, 0.34],
    [0.58, 0.46],
    [0.66, 0.68],
    [0.78, 0.86],
  ].map(([x, y]) => [x * w, y * h]);
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  lane.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.setLineDash([]);
  const vessels = [0.12, 0.38, 0.62, 0.84];
  vessels.forEach((u, index) => {
    const seg = u * (lane.length - 1);
    const i = Math.min(lane.length - 2, Math.floor(seg));
    const f = seg - i;
    const a = lane[i];
    const b = lane[i + 1];
    const x = a[0] + (b[0] - a[0]) * f;
    const y = a[1] + (b[1] - a[1]) * f;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = index === 2 ? ACCENT : INK;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, 4);
    ctx.lineTo(-6, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (index === 2) {
      ctx.strokeStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(x, y, 16 + Math.sin(t * 1.4) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      label(ctx, "TASK", x + 18, y - 8, ACCENT);
    }
  });
  label(ctx, "LANE PLOT", 16, h - 16);
}

const DRAW = {
  defense: drawDefense,
  agriculture: drawAgriculture,
  construction: drawConstruction,
  weather: drawWeather,
  energy: drawEnergy,
  maritime: drawMaritime,
};

export function initChapters() {
  const nodes = [...document.querySelectorAll("[data-plate]")];
  const plates = nodes.map((node) => {
    const canvas = node.querySelector("canvas");
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    return {
      node,
      canvas,
      ctx,
      kind: node.dataset.plate,
      visible: false,
      cssW: 0,
      cssH: 0,
      parcels: null,
      builtFor: "",
    };
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const plate = plates.find((item) => item.node === entry.target);
      if (!plate) return;
      plate.visible = entry.isIntersecting;
      if (entry.isIntersecting) {
        plate.cssW = plate.canvas.clientWidth;
        plate.cssH = plate.canvas.clientHeight;
        paint(plate, performance.now() / 1000, !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      }
    });
  }, { rootMargin: "240px 0px", threshold: 0.01 });
  plates.forEach((plate) => io.observe(plate.node));

  function fit(plate) {
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    const w = plate.cssW || plate.canvas.clientWidth;
    const h = plate.cssH || plate.canvas.clientHeight;
    if (w < 2 || h < 2) return null;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (plate.canvas.width !== W || plate.canvas.height !== H) {
      plate.canvas.width = W;
      plate.canvas.height = H;
    }
    plate.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function paint(plate, seconds, animate) {
    const size = fit(plate);
    if (!size) return;
    const draw = DRAW[plate.kind];
    if (!draw) return;
    draw(plate.ctx, size.w, size.h, animate ? seconds : 0, plate);
    plate.node.classList.add("is-drawn");
  }

  return {
    resize() {
      plates.forEach((plate) => {
        plate.cssW = plate.canvas.clientWidth;
        plate.cssH = plate.canvas.clientHeight;
        plate.builtFor = "";
      });
    },
    tick(now, reduced) {
      const seconds = now / 1000;
      let animating = false;
      plates.forEach((plate) => {
        if (!plate.visible) return;
        paint(plate, seconds, !reduced);
        if (!reduced) animating = true;
      });
      return animating;
    },
    drawVisible(now, reduced) {
      plates.forEach((plate) => {
        if (!plate.visible && plate.cssW === 0) return;
        if (plate.visible) paint(plate, now / 1000, !reduced);
      });
    },
  };
}
