// End-to-End-Tests des Desktop-Programms (Electron) – npm run test:e2e
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'dist/e2e-report', open: 'never' }]],
  outputDir: 'dist/e2e-results',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
