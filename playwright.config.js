import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL:'http://127.0.0.1:4173', trace:'retain-on-failure' },
  projects: [
    { name:'desktop-chromium', use:{ ...devices['Desktop Chrome'] } },
    { name:'iphone', use:{ ...devices['iPhone 13'] } }
  ],
  webServer: {
    command:'npm run start',
    url:'http://127.0.0.1:4173/TradingViewer.html',
    reuseExistingServer:true
  }
});
