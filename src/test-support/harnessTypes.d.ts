import type { OfeliyaTestApi } from './installAutonomousHarness';

declare global {
  interface Window {
    /**
     * Test-only autonomous campaign harness API. Installed only under the
     * main.ts gate (DEV || VITE_QA_TOOLS=1); undefined in production builds.
     */
    __ofeliyaTest?: OfeliyaTestApi;
  }
}

export {};
