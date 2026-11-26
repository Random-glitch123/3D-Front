import { defineConfig } from 'vite';
import string from 'vite-plugin-string';

export default defineConfig({
  plugins: [
    string({
      include: ['**/*.glsl', '**/*.vs', '**/*.fs'],
    }),
  ],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true
  },
  server: {
    port: 5173,
    host: true
  }
});