import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const backend = "http://localhost:3000";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": backend,
      "/auth": backend,
      "/ws": { target: backend, ws: true },
      "/overlay": { target: backend, ws: true },
    },
  },
});
