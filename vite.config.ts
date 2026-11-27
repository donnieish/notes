import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
  base: process.env.PAGES_BASE_PATH || '/',
  plugins: [react()],
  resolve: {alias: [
    {find: '@', replacement: root},
    {find: 'next/navigation', replacement: root + 'src/router.tsx'},
    {find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs'},
  ]},
  build: {emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 800},
});
