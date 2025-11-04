import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude generated directories from build
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/generated/**', '**/node_modules/**'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; worker-src 'self' blob: https://unpkg.com; child-src 'self' blob:; frame-src 'self' https://*.vercel.app https://auth.privy.io https://*.privy.io; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com https: wss: https://auth.privy.io https://*.privy.io wss://relay.walletconnect.org;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
