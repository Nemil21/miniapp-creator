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
              "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://www.unpkg.com https://verify.walletconnect.com https://verify.walletconnect.org; worker-src 'self' blob: data: https://unpkg.com https://www.unpkg.com; child-src 'self' blob: data:; frame-src 'self' https://*.vercel.app https://*.minidev.fun https://auth.privy.io https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://*.walletconnect.com https://*.walletconnect.org; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; img-src 'self' data: https: blob:; font-src 'self' data: https://unpkg.com https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://www.unpkg.com https: wss: https://auth.privy.io https://*.privy.io https://*.walletconnect.com https://*.walletconnect.org wss://relay.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
