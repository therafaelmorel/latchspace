import { formatSubpoint, formatUTC, subpoint, LEAD, visualNow } from "./orbit.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

const canvas = document.getElementById("earth");
const utcEl = document.getElementById("utc");
const utcConsole = document.getElementById("utc-console");
const orbitEl = document.getElementById("orbit-read");
const indexBtn = document.getElementById("index-btn");
const indexPanel = document.getElementById("index-panel");
const folioLinks = [...document.querySelectorAll("[data-folio]")];
const callouts = document.getElementById("callouts");
const pinLines = [...document.querySelectorAll("[data-pin-line]")];
const pinLabels = [...document.querySelectorAll("[data-pin-label]")];
const offField = document.getElementById("off-read");
const passButtons = [...document.querySelectorAll(".pass")];

const pass = { off: 18.4, lat: 34.052, lon: -118.244 };
const industryBeats = new Set(["defense", "agriculture", "construction", "weather", "energy", "maritime"]);
const craftBeats = new Set(["optics", "comms", "solar", "propulsion"]);

let cinema = null;
let raf = 0;
let clockTimer = 0;
let lastSecond = -1;
let layout = null;
let folioId = "";
let needsResize = true;
let scrolled = true;

function box(el, scrollY) {
  const rect = el.getBoundingClientRect();
  const top = rect.top + scrollY;
  return { top, height: rect.height };
}

function measureLayout() {
  const y = window.scrollY;
  layout = {
    vh: window.innerHeight,
    beats: [...document.querySelectorAll("[data-beat]")].map((el) => ({ id: el.dataset.beat, ...box(el, y) })),
    sections: [...document.querySelectorAll("[data-section]")].map((el) => ({ id: el.dataset.section, ...box(el, y) })),
  };
}

function updateClock(now, realMs = Date.now()) {
  const second = Math.floor(realMs / 1000);
  const visual = visualNow(now, reducedMotion);
  const sub = subpoint(LEAD, reducedMotion ? Date.now() : visual);
  const read = formatSubpoint(sub.lat, sub.lon);
  if (orbitEl && orbitEl.textContent !== read) orbitEl.textContent = read;
  if (second === lastSecond) return;
  lastSecond = second;
  const text = formatUTC(realMs);
  const stamp = new Date(realMs).toISOString().slice(0, 19) + "Z";
  if (utcEl) {
    utcEl.textContent = text;
    utcEl.dateTime = stamp;
  }
  if (utcConsole) utcConsole.textContent = text + " UTC";
}

function updateFolio(scrollY) {
  if (!layout) return;
  const mark = scrollY + 96;
  let current = "hero";
  layout.sections.forEach((section) => {
    if (section.top <= mark) current = section.id;
  });
  if (current === folioId) return;
  folioId = current;
  folioLinks.forEach((link) => {
    const on = link.dataset.folio === current;
    link.classList.toggle("is-current", on);
    if (on) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function paintPins(pins) {
  if (!callouts) return;
  const show = pins && pins.length;
  callouts.hidden = !show;
  pinLines.forEach((line, i) => {
    const pin = pins[i];
    line.style.display = pin ? "" : "none";
    if (!pin) return;
    line.setAttribute("x1", pin.x.toFixed(1));
    line.setAttribute("y1", pin.y.toFixed(1));
    line.setAttribute("x2", pin.labelX.toFixed(1));
    line.setAttribute("y2", (pin.labelY + 8).toFixed(1));
  });
  pinLabels.forEach((label, i) => {
    const pin = pins[i];
    label.hidden = !pin;
    if (!pin) return;
    if (label.textContent !== pin.label) label.textContent = pin.label;
    label.style.transform = "translate3d(" + pin.labelX.toFixed(1) + "px," + pin.labelY.toFixed(1) + "px,0)";
  });
}

function armClock() {
  if (clockTimer) return;
  const wait = 1020 - (Date.now() % 1000);
  clockTimer = window.setTimeout(() => {
    clockTimer = 0;
    updateClock(performance.now());
    if (!raf && !document.hidden) armClock();
  }, wait);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  armClock();
}

function ensureLoop() {
  if (document.hidden) return;
  if (clockTimer) {
    clearTimeout(clockTimer);
    clockTimer = 0;
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const scrollY = window.scrollY;
  updateClock(now);
  updateFolio(scrollY);
  if (needsResize) {
    needsResize = false;
    measureLayout();
    cinema?.resize();
  }
  const lost = !!(cinema && cinema.lost);
  if (cinema && !lost) {
    const view = cinema.draw({
      now,
      scrollY,
      reduced: reducedMotion,
      layout,
      pass,
    });
    canvas.classList.add("is-on");
    document.documentElement.classList.remove("no-gl");
    paintPins(view.pins);
    document.body.classList.toggle("is-industries", industryBeats.has(view.beat));
    document.body.classList.toggle("is-craft", craftBeats.has(view.beat));
  } else if (lost) {
    canvas.classList.remove("is-on");
    paintPins([]);
  }
  const busy = (!reducedMotion && cinema && !lost) || scrolled;
  scrolled = false;
  if (document.hidden || !busy) stopLoop();
}

function bindIndex() {
  if (!indexBtn || !indexPanel) return;
  const close = (returnFocus) => {
    if (indexPanel.hidden) return;
    indexPanel.hidden = true;
    indexBtn.setAttribute("aria-expanded", "false");
    if (returnFocus) indexBtn.focus();
  };
  indexBtn.addEventListener("click", () => {
    if (indexPanel.hidden) {
      indexPanel.hidden = false;
      indexBtn.setAttribute("aria-expanded", "true");
      indexPanel.querySelector("a")?.focus();
    } else close(true);
  });
  indexPanel.addEventListener("click", (event) => {
    if (event.target.closest("a")) close(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (indexPanel.hidden) return;
    if (indexPanel.contains(event.target) || indexBtn.contains(event.target)) return;
    close(false);
  });
}

function bindMagnetic() {
  if (reducedMotion || !finePointer) return;
  document.querySelectorAll(".magnetic").forEach((el) => {
    let rect = null;
    el.addEventListener("pointerenter", () => {
      rect = el.getBoundingClientRect();
    });
    el.addEventListener("pointermove", (event) => {
      if (!rect) return;
      const x = event.clientX - (rect.left + rect.width / 2);
      const y = event.clientY - (rect.top + rect.height / 2);
      const tx = Math.max(-8, Math.min(8, x * 0.16));
      const ty = Math.max(-6, Math.min(6, y * 0.22));
      el.style.transform = "translate3d(" + tx + "px," + ty + "px,0)";
    }, { passive: true });
    el.addEventListener("pointerleave", () => {
      el.style.transform = "translate3d(0,0,0)";
      rect = null;
    });
  });
}

function bindPasses() {
  passButtons.forEach((button) => {
    button.addEventListener("click", () => {
      pass.off = Number(button.dataset.off);
      passButtons.forEach((other) => {
        const on = other === button;
        other.classList.toggle("is-selected", on);
        other.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (offField) offField.textContent = pass.off.toFixed(1) + "°";
      scrolled = true;
      ensureLoop();
      if (reducedMotion && cinema) {
        measureLayout();
        cinema.draw({ now: performance.now(), scrollY: window.scrollY, reduced: true, layout, pass });
      }
    });
  });
}

window.addEventListener("scroll", () => {
  scrolled = true;
  updateFolio(window.scrollY);
  if (!reducedMotion) ensureLoop();
  else if (cinema && !cinema.lost) {
    cinema.draw({ now: performance.now(), scrollY: window.scrollY, reduced: true, layout, pass });
  }
}, { passive: true });

window.addEventListener("resize", () => {
  needsResize = true;
  scrolled = true;
  ensureLoop();
}, { passive: true });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopLoop();
  else {
    scrolled = true;
    ensureLoop();
  }
});

bindIndex();
bindMagnetic();
bindPasses();
measureLayout();
updateClock(performance.now());
updateFolio(window.scrollY);

function bootCinema() {
  import("./cinema.js").then((mod) => mod.createCinema(canvas, {
    onRestored() {
      needsResize = true;
      scrolled = true;
      if (reducedMotion) {
        measureLayout();
        cinema?.draw({
          now: performance.now(),
          scrollY: window.scrollY,
          reduced: true,
          layout,
          pass,
        });
      } else {
        ensureLoop();
      }
    },
  })).then((view) => {
    if (!view) {
      document.documentElement.classList.add("no-gl");
      canvas.classList.remove("is-on");
      return;
    }
    cinema = view;
    needsResize = true;
    canvas.classList.add("is-booting");
    cinema.resize();
    if (reducedMotion) {
      measureLayout();
      cinema.draw({ now: performance.now(), scrollY: window.scrollY, reduced: true, layout, pass });
      canvas.classList.add("is-on");
    } else {
      scrolled = true;
      ensureLoop();
    }
  }).catch(() => {
    document.documentElement.classList.add("no-gl");
    canvas.classList.remove("is-on");
  });
}

requestAnimationFrame(bootCinema);

document.fonts.ready.then(() => {
  needsResize = true;
  scrolled = true;
  if (!reducedMotion) ensureLoop();
});
