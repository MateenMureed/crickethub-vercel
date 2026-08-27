import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_ANDROID_BACKEND_URL || env.VITE_BACKEND_URL || 'http://localhost:3001';

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 900,
      // Enable CSS code splitting for faster initial load
      cssCodeSplit: true,
      // Production optimizations — use esbuild (bundled with Vite, no extra deps)
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('react-router')) return 'router-vendor'
            if (id.includes('react-dom') || id.includes('react')) return 'react-vendor'
            if (id.includes('html2canvas')) return 'html-canvas-vendor'
            if (id.includes('@imgly') || id.includes('onnxruntime-web')) return 'imgly-vendor'
            return 'vendor'
          },
        },
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true
        },
        '/uploads': {
          target: backendUrl,
          changeOrigin: true
        },
        '/media': {
          target: backendUrl,
          changeOrigin: true
        }
      }
    }
  };
})
