import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/engine/',
  // Bundled fonts are served at /engine/<file>.ttf
  publicDir: fileURLToPath(new URL('../../assets/fonts', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true },
});
