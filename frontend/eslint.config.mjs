import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next ships flat config as arrays, so these spread directly.
// The typescript entry is what registers the @typescript-eslint plugin.
const config = [
  { ignores: [".next/**", "node_modules/**", "public/sw.js"] },
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
