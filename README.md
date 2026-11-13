# LATCH SPACE

Marketing site for LATCH SPACE, a LATCH STUDIO company. Static, built with Vite, meant to be hosted on Cloudflare Pages.

The page is an editorial instrument: a WebGL Earth with LEO, sun-synchronous, and GEO paths, scroll-linked camera motion, and a chapter for each industry. There is no backend. The briefing link is a mailto.

## Develop

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

Output directory: `dist`. It is a plain static folder (HTML, CSS, JS, images, fonts). No server, no Vercel.

Preview the build locally:

```bash
npm run preview
```

## Cloudflare Pages

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | 22 (see `.node-version`) |
| Root directory | `/` |

`public/_headers` is copied into `dist` and sets basic security and cache headers. Do not add a Vercel project or `vercel.json`.

Environment variables are not required.

## Brand

- Inter only, self-hosted, `font-display: swap`. The subset is inlined into the stylesheet so the first paint does not fall through to another face. The same file is also at `public/fonts/inter.woff2` for the 404 page. License: `public/fonts/OFL.txt` (SIL Open Font License).
- No italic, no serif, no second family in the UI.
- LATCH SPACE, LATCH STUDIO, and any other LATCH name stay in capitals and do not wrap (`white-space: nowrap`).

## Pictures and honesty

- Day texture: NASA Blue Marble (public domain), resized to 2048×1024 and saved as WebP.
- Night texture: city lights isolated from NASA Black Marble (public domain), resized and saved as WebP.
- LEO and sun-synchronous radii are drawn to scale with the Earth. The GEO ring is drawn closer than its true altitude (about 6.6 Earth radii) so it fits the frame. The page says so.
- The picture's clock runs faster than UTC so a pass is visible. The header clock is real UTC. The header track is a reference model at 51.6°, not a flown spacecraft.
- Industry plates and the tasking console are labeled illustrative. They are not collects, forecasts, or specifications.
- The page does not name customers, funding, launch counts, certifications, or measured performance.

## Motion and performance

- One `requestAnimationFrame` loop drives the globe, the plates, and the clock. It stops when the tab is hidden, and when neither the globe nor a plate is on screen. The clock then updates on a one-second timer.
- `devicePixelRatio` is capped at 2, and at 1.5 below 760px.
- On small screens the globe is the hero and the closing section. Chapters use the drawn plates.
- `prefers-reduced-motion` freezes the globe, the plates, and the camera, and turns off smooth scrolling and the magnetic control.
- There is no sound.

Measured on this build, Lighthouse mobile (simulated throttling, local preview): performance 94, accessibility 100, best practices 100, SEO 100. Largest contentful paint 1.4 s, cumulative layout shift 0. During a scroll from the hero through the industry chapters at 1440×900, the globe draw itself was about 0.1 ms at the median and 2.2 ms at the worst sample. The frame interval in that headless session sat on a 30 Hz tick (median 33 ms), which is the browser's refresh in this environment, not the draw. A 60 Hz laptop has the same draw inside a 16.7 ms frame.

## Accessibility

Semantic sections, a skip link, a keyboard-reachable index, visible focus, and text that does not depend on the canvas. The canvas is decorative.
