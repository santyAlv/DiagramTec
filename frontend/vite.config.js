import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'os';

/** IP de Wi‑Fi/LAN (evita 192.168.56.x de VirtualBox que el móvil no alcanza). */
function getLanUrl(port) {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    if (lower.includes('vethernet') || lower.includes('virtualbox') || lower.includes('vmware') || lower.includes('hyper-v')) {
      continue;
    }
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('192.168.56.')) continue;
      candidates.push(net.address);
    }
  }
  const ip = candidates.find((a) => a.startsWith('192.168.')) || candidates[0];
  return ip ? `http://${ip}:${port}/` : null;
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'log-lan-url',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const lan = getLanUrl(5173);
          if (lan) {
            console.log(`\n  📱 Móvil (misma Wi‑Fi): ${lan}\n`);
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: true,
  },
});
