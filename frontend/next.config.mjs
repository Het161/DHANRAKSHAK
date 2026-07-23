import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Without an explicit root, the bundler walks up past the monorepo looking for
  // a workspace manifest and trips over directories it cannot read.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app records nothing and needs no location, camera-roll or ad
          // access; the microphone is requested only for the voice tab.
          { key: "Permissions-Policy", value: "geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
