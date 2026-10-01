import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "prisma/generated/**",
      // Door Next.js zelf gegenereerd bij elke `next dev`/`next build`, staat in
      // .gitignore en mag niet bewerkt worden ("This file should not be edited").
      // Sinds Next 15.5 zet de generator er een `/// <reference path=...>` in, wat
      // `@typescript-eslint/triple-slash-reference` terecht afkeurt — maar aan een
      // gegenereerd bestand is niets te verhelpen.
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
