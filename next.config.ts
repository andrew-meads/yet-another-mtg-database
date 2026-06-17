import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow E2E tests to run a second, isolated dev server (own build dir + dev
  // lock) without disturbing a developer's running `.next`. Unset in normal use.
  ...(process.env.E2E_DIST_DIR ? { distDir: process.env.E2E_DIST_DIR } : {}),

  images: {
    // Allow optimizing remote images from Scryfall
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cards.scryfall.io",
        port: "",
        pathname: "/**"
      },
      {
        protocol: "https",
        hostname: "errors.scryfall.com",
        port: "",
        pathname: "/**"
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        port: "",
        pathname: "/**"
      }
    ],
    // Prefer modern formats when available
    formats: ["image/avif", "image/webp"],
    // Minimum time (in seconds) to cache optimized remote images on the server
    // This doesn't force the browser to cache this long; it's the server-side cache TTL.
    minimumCacheTTL: 31536000 // ~1 year
  },

  experimental: {
    turbopackFileSystemCacheForDev: false
  }
};

export default nextConfig;
