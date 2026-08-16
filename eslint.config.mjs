import next from "eslint-config-next";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config.
 *
 * `next lint` was removed in Next 16, so lint runs through ESLint directly.
 * The rules below are the ones that catch real problems in this codebase —
 * accidentally floating promises around database writes, and unused code left
 * behind by a refactor. Formatting is deliberately not linted.
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "prisma/migrations/**",
    ],
  },

  ...next,
  ...tseslint.configs.recommended,

  {
    rules: {
      // An unawaited Prisma call silently loses a write. Worth an error.
      "@typescript-eslint/no-floating-promises": "off", // needs type info; see typed block below
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off", // the logger and CLI scripts write to stdout on purpose
    },
  },

  // Type-aware rules, restricted to source files so linting stays fast.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },

  {
    files: ["tests/**/*.ts", "scripts/**/*.ts", "prisma/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
