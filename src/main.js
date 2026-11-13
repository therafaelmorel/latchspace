import { formatSubpoint, formatUTC, subpoint, LEAD, visualNow } from "./orbit.js";
import { initChapters } from "./chapters.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobileQuery = window.matchMedia("(max-width: 760px)");
const finePointer = window.matchMedia("(pointer: fine)").matches;
const measure = new URLSearchParams(location.search).has("measure");
const frames = [];
const drawMs = [];
if (measure) {
  window.__latchFrames = frames;
  window.__drawMs = drawMs;
}

const canvas = document.getElementById("earth");
const utcEl = document.getElementById("utc");
const utcConsole = document.getElementById("utc-console");
const orbitEl = document.getElementById("orbit-read");
const indexBtn = document.getElementById("index-btn");
const indexPanel = document.getElementById("index-panel");
const folioLinks = [...document.querySelectorAll("[data-folio]")];

let earth = null;
let chapters = null;
let raf = 0;
let clockTimer = 0;
let lastSecond = -1;
let lastFrame = 0;
let layout = null;
let folioId = "";
let needsResize = true;
let scrolled = true;

function box(id) {
  const el = document.getElementById(id);
  const rect = el.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  return { top, height: rect.height, bottom: top + rect.height };
}

function measureLayout() {
  const y = window.scrollY;
  layout = {
    hero: box("hero"),
    industries: box("industries"),
    briefing: box("briefing"),
    vh: window.innerHeight,
    scenes: [...document.querySelectorAll("[data-scene]")].map((el) => {
      const rect = el.getBoundingClientRect();
      const top = rect.top + y;
      return { id: el.id, top, bottom: top + rect.height, on: el.dataset.scene === "on" };
    }),
    sections: [...document.querySelectorAll("[data-section]")].map((el) => {
      const rect = el.getBoundingClientRect();
      return { id: el.dataset.section, top: rect.top + y };
    }),
  };
}

function sceneOn(scrollY) {
  if (!layout) return true;
  const mid = scrollY + window.innerHeight * 0.42;
  const hit = layout.scenes.find((scene) => mid >= scene.top && mid < scene.bottom);
  if (!hit) return false;
  if (mobileQuery.matches) {
    const inHero = mid < layout.hero.bottom;
    const inClose = mid > layout.briefing.top;
    return (inHero || inClose) && hit.on;
  }
  return hit.on;
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
  if (measure && lastFrame) frames.push(now - lastFrame);
  lastFrame = now;
  const scrollY = window.scrollY;
  updateClock(now);
  updateFolio(scrollY);
  if (needsResize) {
    needsResize = false;
    measureLayout();
    earth?.resize();
    chapters?.resize();
  }
  const visible = sceneOn(scrollY) && !document.hidden;
  const showEarth = !!earth && !earth.lost && visible;
  if (showEarth) {
    canvas.classList.add("is-on");
    const drawStart = measure ? performance.now() : 0;
    earth.draw({
      now,
      scrollY,
      reduced: reducedMotion,
      layout,
    });
    if (measure) drawMs.push(performance.now() - drawStart);
  } else if (!visible) {
    canvas.classList.remove("is-on");
  }
  const plates = chapters ? chapters.tick(now, reducedMotion) : false;
  const busy = (!reducedMotion && showEarth) || plates || scrolled;
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
  const open = () => {
    indexPanel.hidden = false;
    indexBtn.setAttribute("aria-expanded", "true");
    const first = indexPanel.querySelector("a");
    first?.focus();
  };
  indexBtn.addEventListener("click", () => {
    if (indexPanel.hidden) open();
    else close(true);
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
      const tx = Math.max(-10, Math.min(10, x * 0.18));
      const ty = Math.max(-8, Math.min(8, y * 0.28));
      el.style.transform = "translate3d(" + tx + "px," + ty + "px,0)";
    }, { passive: true });
    el.addEventListener("pointerleave", () => {
      el.style.transform = "translate3d(0,0,0)";
      rect = null;
    });
  });
}

window.addEventListener("scroll", () => {
  scrolled = true;
  updateFolio(window.scrollY);
  if (!reducedMotion) ensureLoop();
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
chapters = initChapters();
measureLayout();
updateClock(performance.now());
updateFolio(window.scrollY);
document.fonts.ready.then(() => {
  needsResize = true;
  chapters?.resize();
  if (!reducedMotion) ensureLoop();
  else chapters?.drawVisible(performance.now(), true);
});

const bootEarth = () => {
  import("./earth.js").then((mod) => mod.createEarth(canvas, {
    onRestored() {
      needsResize = true;
      scrolled = true;
      if (reducedMotion) {
        measureLayout();
        earth.draw({
          now: performance.now(),
          scrollY: window.scrollY,
          reduced: true,
          layout,
        });
      } else {
        ensureLoop();
      }
    },
  })).then((renderer) => {
    earth = renderer;
    needsResize = true;
    canvas.classList.add("is-booting", "is-on");
    earth.resize();
    if (reducedMotion) {
      measureLayout();
      earth.draw({
        now: performance.now(),
        scrollY: window.scrollY,
        reduced: true,
        layout,
      });
    } else {
      scrolled = true;
      ensureLoop();
    }
  }).catch(() => {
    document.documentElement.classList.add("no-gl");
    canvas.classList.remove("is-on");
  });
};
if (typeof requestIdleCallback === "function") {
  requestIdleCallback(bootEarth, { timeout: 1500 });
} else {
  setTimeout(bootEarth, 1);
}

if (!reducedMotion) ensureLoop();
else armClock();
