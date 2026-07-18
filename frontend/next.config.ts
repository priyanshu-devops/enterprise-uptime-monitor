import type { NextConfig } from 'next';

// Trigger Vercel Build

const nextConfig: NextConfig = {
  transpilePackages: ['@uptime/shared'],
  images: {
    // Screenshots/thumbnails come from GitHub Pages; use plain <img> so no
    // remote loader config is needed, but keep this permissive for future use.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
