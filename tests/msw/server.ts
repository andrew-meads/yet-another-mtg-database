import { setupServer } from "msw/node";

/**
 * Shared MSW server for jsdom (component/hook) tests. Tests register their own
 * handlers with `server.use(...)`; unhandled requests are bypassed by default
 * (see vitest.setup.jsdom.ts).
 */
export const server = setupServer();
