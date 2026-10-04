import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const SRC = resolve(__dirname, "../src");

export default defineConfig({
  base: "./",
  root: __dirname,
  plugins: [react()],
  css: { postcss: resolve(__dirname, "../postcss.config.js") },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2020",
  },
  resolve: {
    alias: { "@": SRC },
  },
});
