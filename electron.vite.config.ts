import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite baut drei Bundles: main (out/main), preload (out/preload), renderer (out/renderer).
// Wichtig: electron-store@12 ist ESM-only. externalizeDepsPlugin würde es per require() im
// CJS-Main externalisieren → Laufzeitfehler. Deshalb aus der Externalisierung ausschließen,
// damit Rollup es in das Main-Bundle inlined. bonjour-service / prolink-connect bleiben extern
// (CJS, node_modules) und werden von electron-builder mitverpackt.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    // Besitzt der Renderer-Agent: src/renderer/index.html + src/renderer/src/main.tsx
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
