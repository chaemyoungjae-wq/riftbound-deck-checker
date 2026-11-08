import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the API provider behind one server-side route in development and preview.
const riftcodexProxy: ProxyOptions = {
  target: 'https://api.riftcodex.com',
  changeOrigin: true,
  secure: true,
  rewrite: (path) => path.replace(/^\/api\/riftcodex/, ''),
  timeout: 15_000,
  proxyTimeout: 15_000,
  configure(proxy) {
    // Short browser cache; the adapter also keeps a ten-minute in-memory catalog cache.
    proxy.on('proxyRes', (response) => {
      response.headers['cache-control'] = response.statusCode && response.statusCode >= 200 && response.statusCode < 300
        ? 'public, max-age=600'
        : 'no-store';
    });
  },
};

const openriftProxy: ProxyOptions = {
  target: 'https://openrift.app',
  changeOrigin: true,
  secure: true,
  rewrite: (path) => path.replace(/^\/api\/openrift/, '/api/v1'),
  timeout: 60_000,
  proxyTimeout: 60_000,
  configure(proxy) {
    proxy.on('proxyRes', (response) => {
      response.headers['cache-control'] = response.statusCode && response.statusCode >= 200 && response.statusCode < 300
        ? 'public, max-age=300'
        : 'no-store';
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api/riftcodex': riftcodexProxy, '/api/openrift': openriftProxy } },
  preview: { proxy: { '/api/riftcodex': riftcodexProxy, '/api/openrift': openriftProxy } },
});
