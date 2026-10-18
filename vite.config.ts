import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any subfolder (GitHub Pages).
  base: './',
  build: { target: 'es2022' },
  server: { port: 5173 },
});
