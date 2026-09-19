import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "public/icons/**", dest: "icons" },
      ],
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
        "background/service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        // NOTE: content scripts are NOT built here — MV3 content scripts are
        // classic scripts and cannot use static ESM imports. They are bundled
        // as self-contained IIFE files by scripts/build-content.mjs (see
        // `npm run build:content`).
      },
      output: {
        entryFileNames: (chunkInfo) => {
          const name = chunkInfo.name || "";
          if (name.startsWith("background/")) return `${name}.js`;
          return `assets/[name]-[hash].js`;
        },
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
    sourcemap: false,
    minify: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
