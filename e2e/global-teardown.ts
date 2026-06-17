import type { MongoMemoryServer } from "mongodb-memory-server";

async function globalTeardown() {
  const mongod = (globalThis as unknown as { __E2E_MONGOD__?: MongoMemoryServer }).__E2E_MONGOD__;
  if (mongod) {
    await mongod.stop();
  }
}

export default globalTeardown;
