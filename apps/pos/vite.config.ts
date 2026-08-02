import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Salon Platform',
        short_name: 'Salon',
        // Inlined by index.html on boot too — see DESIGN.md, no colour flash on cold start.
        background_color: '#F3F5F7',
        theme_color: '#0F5DA8',
        display: 'standalone',
        start_url: '/',
      },
      workbox: {
        // The app shell is precached so a cold start on a 4GB i3 paints
        // in under a second with no network.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
