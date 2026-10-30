const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const nodeGlobals = require('globals').node;

module.exports = defineConfig([
  expoConfig,
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: nodeGlobals,
    },
    rules: {
      'import/no-unresolved': 'off',
    },
  },
  {
    ignores: [
      "dist/*",
      ".expo/**/*",
      ".expo-verify/**/*",
      ".expo-export-check/**/*",
      ".cache-web-export/**/*",
      ".tmp-*/**/*",
      ".tmp-*",
      "tmp-*",
      "android/**/*",
      ".github/**/*",
      "node_modules/**/*",
      "supabase/functions/**/*",
      "api/**/*",
      "server/**/*"
    ],
  }
]);
