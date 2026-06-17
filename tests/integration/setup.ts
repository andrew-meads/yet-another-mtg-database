import { afterEach, beforeAll, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import connectDB from "@/db/mongoose";

/**
 * Integration DB lifecycle. This project runs in a single fork with isolation
 * disabled (see vitest.config.ts), so the module-level `mongod` singleton and the
 * mongoose connection are shared across every integration file. We set
 * MONGO_DB_URI *before* any route handler calls connectDB (src/db/mongoose.ts).
 *
 * The server is intentionally not stopped in an afterAll hook — afterAll runs
 * per-file under isolate:false, which would tear the server down mid-suite.
 * mongodb-memory-server cleans up its mongod child when the worker process exits.
 */
let mongod: MongoMemoryServer | undefined;

beforeAll(async () => {
  if (!mongod) {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_DB_URI = mongod.getUri();
    // Connect once so tests that hit models directly (helpers) work without a
    // route handler having called connectDB first. Route handlers reuse this
    // cached connection.
    await connectDB();
  }
});

afterEach(async () => {
  const { db } = mongoose.connection;
  if (mongoose.connection.readyState === 1 && db) {
    const collections = await db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  }
});

// ---------------------------------------------------------------------------
// Auth: mock getServerSession so route handlers see whichever user the test set
// via setTestUser(...). Partial-mocked so @/auth (NextAuth, GoogleProvider) keeps
// working. The mutable session lives on globalThis so the (hoisted) factory and
// the setTestUser helper share it across the disabled-isolation worker.
// ---------------------------------------------------------------------------
const authState = vi.hoisted(() => {
  const g = globalThis as unknown as { __authState?: { session: unknown } };
  g.__authState ??= { session: null };
  return g.__authState;
});

vi.mock("next-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth")>();
  return {
    ...actual,
    getServerSession: vi.fn(async () => authState.session)
  };
});
