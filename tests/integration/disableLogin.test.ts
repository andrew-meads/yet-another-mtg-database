import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Types } from "mongoose";
import { GET as listSummaries } from "@/app/api/collections/summaries/route";
import { NO_AUTH_USER_ID } from "@/auth";
import { CollectionModel, UserModel } from "@/db/schema";
import { jsonRequest, setTestUser } from "./helpers";

const original = process.env.DISABLE_LOGIN;

beforeEach(() => {
  process.env.DISABLE_LOGIN = "true";
  // No mocked session: no-auth mode must work without one.
  setTestUser(null);
});

afterEach(() => {
  // Restore so the rest of the (sequential) integration suite runs authenticated.
  if (original === undefined) delete process.env.DISABLE_LOGIN;
  else process.env.DISABLE_LOGIN = original;
});

describe("DISABLE_LOGIN mode", () => {
  it("provisions the fixed user + active Main Collection and scopes routes to it", async () => {
    const res = await listSummaries(jsonRequest("/api/collections/summaries", "GET"));
    expect(res.status).toBe(200);

    const { collections } = await res.json();
    // The auto-created "Main Collection" is returned, owned by the fixed user.
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("Main Collection");
    expect(collections[0].isActive).toBe(true);
    expect(String(collections[0].owner)).toBe(NO_AUTH_USER_ID);

    // The fixed user document was created with the expected _id.
    const user = await UserModel.findById(new Types.ObjectId(NO_AUTH_USER_ID)).lean();
    expect(user).not.toBeNull();

    // And it owns exactly one active collection.
    const owned = await CollectionModel.countDocuments({
      owner: new Types.ObjectId(NO_AUTH_USER_ID)
    });
    expect(owned).toBe(1);
  });
});
