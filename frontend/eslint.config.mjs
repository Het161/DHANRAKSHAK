import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next ships flat config as arrays, so these spread directly.
// The typescript entry is what registers the @typescript-eslint plugin.
const config = [
  // public/sw.js has build-time placeholders; engine-worker.js is a generated bundle.
  { ignores: [".next/**", "node_modules/**", "out/**", "public/sw.js", "public/engine-worker.js"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "error",
    },
  },
];

export default config;
