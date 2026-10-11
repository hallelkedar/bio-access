import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const BACKEND = "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // One origin for the browser: the dev server forwards API calls to the backend,
    // so there is no CORS in development and the app can use relative URLs.
    proxy: {
      "/api": BACKEND,
      "/media": BACKEND,
      "/webhooks": BACKEND,
      "/ws": { target: BACKEND, ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
