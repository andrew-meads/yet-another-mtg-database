import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow optimizing remote images from Scryfall
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cards.scryfall.io",
        port: "",
        pathname: "/**"
      }
    ],
    // Prefer modern formats when available
    formats: ["image/avif", "image/webp"],
    // Minimum time (in seconds) to cache optimized remote images on the server
    // This doesn't force the browser to cache this long; it's the server-side cache TTL.
    minimumCacheTTL: 31536000 // ~1 year
  }
};

export default nextConfig;
