import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      // Downgrade new React Compiler rules to warnings (introduced in Next.js 16)
      // These are valid suggestions but need time to fix properly
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/incompatible-library": "warn",
      // Existing rules
      "react/jsx-no-constructed-context-values": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-img-element": "warn",
      "react/jsx-no-comment-textnodes": "warn",
    },
  },
  {
    files: ["**/*.tsx"],
    rules: {
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "node_modules/**",
      "coverage/**",
      ".env*",
    ],
  },
];

export default eslintConfig;
