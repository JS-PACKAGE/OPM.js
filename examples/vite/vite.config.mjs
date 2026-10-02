import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.OPM_EXAMPLE_BASE || '/',
  build: { target: 'es2022' },
});
