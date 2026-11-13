// Geographic frame: +Y north, longitude 0 at +Z, east toward +X.
// Satellite motion in the picture is time-lapsed so a pass is legible.
// The header model uses the same lead orbit. It is not a tracked vehicle.
// GEO is held at a fixed geographic longitude. Its drawn radius is compressed
// in the scene (see earth.js); the longitude here is the model, not a claim
// about a flown spacecraft.

const DEG = Math.PI / 180;
const DAY = 86400000;

const t0 = performance.now();
const date0 = Date.now();

// A LEO revolution takes about a minute of viewing time.
export const LAPSE = 90;

export const SATS = [
  { id: "leo-a", kind: "leo", radius: 1.086, inc: 51.6, raan: 0.45, phase: 1.15, perDay: 15.5, lead: true },
  { id: "leo-b", kind: "leo", radius: 1.094, inc: 51.6, raan: 2.55, phase: 3.6, perDay: 15.5, lead: false },
  { id: "sso", kind: "sso", radius: 1.124, inc: 98.1, raan: 1.15, phase: 2.4, perDay: 14.4, lead: false },
  { id: "geo", kind: "geo", radius: 1.72, inc: 0, raan: 0.2, phase: 1.05, perDay: 0, lead: false },
];

export const LEAD = SATS[0];

export function visualNow(now = performance.now(), reduced = false) {
  if (reduced) return date0;
  return date0 + (now - t0) * (LAPSE - 1);
}

export function orbitPoint(radius, incDeg, raan, nu, out) {
  const i = incDeg * DEG;
  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  const cu = Math.cos(nu);
  const su = Math.sin(nu);
  const ci = Math.cos(i);
  const si = Math.sin(i);
  const classicX = radius * (cO * cu - sO * su * ci);
  const classicY = radius * (sO * cu + cO * su * ci);
  const classicZ = radius * su * si;
  if (!out) return [classicY, classicZ, classicX];
  out[0] = classicY;
  out[1] = classicZ;
  out[2] = classicX;
  return out;
}

export function anomaly(sat, ms) {
  return sat.phase + (ms / DAY) * sat.perDay * Math.PI * 2;
}

export function satellitePosition(sat, ms) {
  return orbitPoint(sat.radius, sat.inc, sat.raan, anomaly(sat, ms));
}

export function subpoint(sat, ms) {
  const p = satellitePosition(sat, ms);
  const lat = Math.asin(Math.max(-1, Math.min(1, p[1] / sat.radius))) / DEG;
  let lon = Math.atan2(p[0], p[2]) / DEG;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Day of year and UTC hours without allocating a Date.
function utcDay(ms) {
  let days = Math.floor(ms / DAY);
  const tod = ms - days * DAY;
  let year = 1970;
  while (year < 4000) {
    const span = isLeap(year) ? 366 : 365;
    if (days < span) return { doy: days + 1, hours: tod / 3600000 };
    days -= span;
    year += 1;
  }
  return { doy: 1, hours: 0 };
}

// Sun direction in the same geographic frame. Declination is the day of year.
// Hour angle puts local noon on the subsolar meridian. Simplified; no equation of time.
const sunScratch = [0, 0, 1];
let sunStamp = Number.NaN;

export function sunDirectionInto(ms, out) {
  if (ms !== sunStamp) {
    sunStamp = ms;
    const mark = utcDay(ms);
    const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (mark.doy - 81)) / 365);
    const sub = -(mark.hours - 12) * 15 * DEG;
    const cd = Math.cos(decl);
    sunScratch[0] = cd * Math.sin(sub);
    sunScratch[1] = Math.sin(decl);
    sunScratch[2] = cd * Math.cos(sub);
  }
  out[0] = sunScratch[0];
  out[1] = sunScratch[1];
  out[2] = sunScratch[2];
  return out;
}

export function formatSubpoint(lat, lon) {
  const hemiLat = lat >= 0 ? "N" : "S";
  const hemiLon = lon >= 0 ? "E" : "W";
  const latStr = Math.abs(lat).toFixed(1).padStart(4, "0");
  const lonStr = Math.abs(lon).toFixed(1).padStart(5, "0");
  return latStr + "\u00b0 " + hemiLat + "  " + lonStr + "\u00b0 " + hemiLon;
}

export function formatUTC(ms) {
  const date = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return p(date.getUTCHours()) + ":" + p(date.getUTCMinutes()) + ":" + p(date.getUTCSeconds());
}
