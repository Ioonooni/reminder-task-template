import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'นาฬิกาพลิกตะแคงตัว', short_name: 'เตือนพลิกตะแคง',
      description: 'ระบบเตือนพลิกตะแคงตัวสำหรับพยาบาล',
      start_url: '/', scope: '/', display: 'standalone',
      background_color: '#f6faf9', theme_color: '#125c58',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
      ]
    },
    workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg}'], importScripts: ['push-handler.js'] }
  })]
})
