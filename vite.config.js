import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    cssCodeSplit: false,
    sourcemap: false,
    target: "es2020",
    modulePreload: true,
  },
  // Inline the small Inter subset so the first paint is already Inter.
  assetsInlineLimit: 100000,
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
