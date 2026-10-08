import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/*
 * Ports: the Vite dev server listens on WEB_PORT (default 8081) and proxies
 * /api to the Express server on API_PORT (default 5000, the port the API
 * server itself defaults to). PORT is left to the API server so the two never
 * collide when both read the same shell environment.
 */
const port = Number(process.env.WEB_PORT ?? "8081");
const apiPort = Number(process.env.API_PORT ?? "5000");

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: false,
      allow: ["../.."],
    },
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
