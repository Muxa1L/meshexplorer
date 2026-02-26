import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  webpack(config, { isServer }) {
    if (!isServer) {
      // @liamcottle/meshcore.js includes Node.js-only transitive deps
      // (serialport → fs/net/child_process, tcp_connection → net).
      // Stub them out so the browser build succeeds; only WebBleConnection
      // (which uses the Web Bluetooth API) is actually used client-side.
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        buffer: false,
      };
    }
    return config;
  },
};

export default nextConfig;
