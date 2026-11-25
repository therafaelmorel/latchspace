// The camera is a fixed rail of holds. Each hold names exactly what the
// viewer should see, where it sits on screen, and how it is lit. Scrolling
// moves along the rail; a critically damped spring follows it.
//
// Framing is relative to the "free area": the part of the viewport the text
// panel does not cover (measured live in main.js). `frame` is the fraction of
// the free area's smaller side the subject's diameter should fill.
//
// Lighting is art-directed per hold. `sun` is given in the camera's frame
// (x right, y up, z toward the viewer) for globe holds, and in the
// spacecraft's own frame for spacecraft holds. The live UTC clock stays in
// the header only.

// Lowest camera altitude allowed over the globe, in Earth radii (3,060 km).
export const MIN_ALT = 0.48;

// Spacecraft holds orbit the craft at one constant distance.
export const CRAFT = {
  lat: 9,
  lon: 116,
  radius: 1.5,
  orbit: 0.78,
};

const EARTH_HOLD = { subject: "earth" };

export const HOLDS = [
  {
    id: "hero",
    shot: "hero",
    ...EARTH_HOLD,
    view: { lat: 16, lon: 28 },
    desktop: { frame: 0.8, sat: { sx: 0.42, sy: 0.62, depth: 0.52, scale: 1 } },
    mobile: { frame: 0.98, sat: { sx: 0.45, sy: 0.55, depth: 0.5, scale: 0.8 } },
    sun: [-0.55, 0.42, 0.72],
    satMode: "beauty",
    orbits: 0.45,
    clouds: 1,
  },
  {
    id: "capability",
    shot: "orbits",
    ...EARTH_HOLD,
    view: { lat: 24, lon: -32 },
    desktop: { frame: 0.42, sat: { sx: -0.5, sy: 0.42, depth: 0.8, scale: 0.42 } },
    mobile: { frame: 0.5, sat: { sx: -0.55, sy: 0.5, depth: 0.82, scale: 0.36 } },
    sun: [-0.35, 0.45, 0.82],
    satMode: "nadir",
    orbits: 1,
    clouds: 1,
    labels: "orbits",
  },
  site("agriculture", "Agriculture", "San Joaquin Valley, illustrative", 36.55, -119.85, 0.085),
  site("energy", "Energy", "Permian Basin, illustrative", 32.35, -101.2, 0.075),
  site("construction", "Construction", "Hampton Roads, illustrative", 36.9, -76.1, 0.13),
  site("weather", "Weather", "Western Atlantic, illustrative", 28, -68, 0.11),
  site("defense", "Defense", "Strait of Gibraltar, illustrative", 35.95, -5.6, 0.1),
  site("maritime", "Maritime", "Strait of Malacca, illustrative", 2.75, 102.5, 0.075),
  craftHold("optics", "optics", [0.36, 0.26, 0.9], 22, [["optics", "Multispectral telescope"]], [0.3, 0.65, 0.7]),
  craftHold("comms", "comms", [0.78, -0.2, -0.6], 24, [["comms", "Laser-com terminal"], ["array", "Ka/X-band array"]], [0.75, 0.45, -0.2]),
  craftHold("solar", "solar", [0.22, 0.46, 0.86], 36, [["solar", "Solar wing"], ["mli", "Kapton MLI"]], [0.25, 0.8, 0.55]),
  craftHold("propulsion", "thruster", [-0.2, 0.85, -0.48], 24, [["thruster", "Hall thruster"], ["tracker", "Star tracker"]], [-0.45, 0.7, -0.55]),
  {
    id: "console",
    shot: "console",
    subject: "site",
    lat: 34.05,
    lon: -118.24,
    radius: 0.17,
    tilt: 24,
    desktop: { frame: 0.8, sat: { sx: 0.62, sy: 0.72, dist: 0.62, scale: 0.22 } },
    mobile: { frame: 0.85, sat: { sx: 0.55, sy: 0.7, dist: 0.7, scale: 0.2 } },
    sun: [-0.4, 0.55, 0.75],
    satMode: "nadir",
    orbits: 0.3,
    clouds: 0.45,
    glint: 0.25,
    swath: true,
    labels: "site",
    label: "Pass over Los Angeles, illustrative",
  },
  {
    id: "method",
    shot: "method",
    ...EARTH_HOLD,
    view: { lat: -8, lon: 70 },
    desktop: { frame: 0.92, sat: { sx: -0.55, sy: 0.5, depth: 0.74, scale: 0.4 } },
    mobile: { frame: 1.05, sat: { sx: -0.5, sy: 0.5, depth: 0.74, scale: 0.34 } },
    sun: [-0.5, 0.35, 0.8],
    satMode: "nadir",
    orbits: 0.7,
    clouds: 1,
  },
  {
    id: "briefing",
    shot: "briefing",
    ...EARTH_HOLD,
    view: { lat: 38, lon: 12 },
    desktop: { frame: 0.78, sat: { sx: -0.45, sy: 0.55, depth: 0.6, scale: 0.55 } },
    mobile: { frame: 0.95, sat: { sx: -0.45, sy: 0.5, depth: 0.6, scale: 0.5 } },
    sun: [0.35, 0.25, -0.9],
    satMode: "beauty",
    orbits: 0.15,
    clouds: 0.5,
  },
];

function site(id, name, place, lat, lon, radius) {
  return {
    id,
    shot: "industries",
    subject: "site",
    lat,
    lon,
    radius,
    tilt: 12,
    // The spacecraft waits just above the top of the frame, out of view.
    desktop: { frame: 0.82, sat: { sx: 0, sy: 2.7, dist: 1.25, scale: 0.6 } },
    mobile: { frame: 0.42, sat: { sx: 0, sy: 2.7, dist: 1.25, scale: 0.6 } },
    sun: [-0.55, 0.6, 0.58],
    glint: 0.12,
    satMode: "nadir",
    orbits: 0,
    clouds: 0.12,
    industry: id,
    labels: "site",
    label: name + " · " + place,
  };
}

function craftHold(id, anchor, dir, fov, pins, sun) {
  return {
    id,
    shot: "spacecraft",
    subject: "craft",
    anchor,
    dir,
    fov,
    pins,
    sun,
    satMode: "fixed",
    orbits: 0,
    clouds: 0.6,
    desktop: { frame: 1 },
    mobile: { frame: 1, fovScale: 1.25 },
  };
}

export const HOLD_INDEX = Object.fromEntries(HOLDS.map((hold, i) => [hold.id, i]));
