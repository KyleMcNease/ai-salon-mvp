import nextConfig from 'eslint-config-next';

export default [
  ...nextConfig,
  {
    ignores: ['ai-salon/**', 'node_modules/**', '*.config.js', '*.config.ts'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];
