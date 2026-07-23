import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The app is entirely client-side over the API, so it ships as a static export:
  // any static host serves it, with no Next server runtime to depend on.
  // Security headers move to the host (see netlify.toml); export cannot emit them.
  output: "export",
  images: { unoptimized: true },
  // Without an explicit root, the bundler walks up past the monorepo looking for
  // a workspace manifest and trips over directories it cannot read.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
