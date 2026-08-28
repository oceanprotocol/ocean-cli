import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";


export default [
  { ignores: ["dist/**"] },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
  }},
  {
    // Test files: chai assertions (`expect(x).to.be.true`) are bare expressions
    // by design, and rethrow-with-cause adds nothing to test scaffolding.
    files: ["test/**/*.ts"],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      'preserve-caught-error': 'off',
    }
  }
];
