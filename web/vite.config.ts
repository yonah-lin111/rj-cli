import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const apiPort = process.env.VITE_API_PORT ?? "3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        rank: path.resolve(__dirname, "index.html"),
        circle: path.resolve(__dirname, "circle.html"),
        works: path.resolve(__dirname, "works.html"),
        workOps: path.resolve(__dirname, "work-ops.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
