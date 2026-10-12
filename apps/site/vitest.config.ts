import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: '@artyfact/site', environment: 'jsdom', include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] } });
