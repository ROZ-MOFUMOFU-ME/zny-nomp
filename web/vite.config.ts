import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The portal's Express server (libs/website.ts) serves the built SPA from
// web/dist and exposes the JSON API under /api (+ the /key.html wallet tool).
// In dev, proxy those to the running portal (default website port 8080).
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'dist',
        emptyOutDir: true
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:8080',
            '/key.html': 'http://localhost:8080'
        }
    }
});
