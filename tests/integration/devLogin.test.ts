import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { GET as listSummaries } from "@/app/api/collections/summaries/route";
import { provisionDevUser, DEV_USER_ID, DEV_USER_EMAIL } from "@/auth";
import { CollectionModel, UserModel } from "@/db/schema";
import { jsonRequest, setTestUser } from "./helpers";

describe("dev-login provisioning", () => {
  it("creates the fixed dev user + active Main Collection and returns the session user", async () => {
    const user = await provisionDevUser();
    expect(user).toEqual({
      id: DEV_USER_ID,
      _id: DEV_USER_ID,
      name: "Dev User",
      email: DEV_USER_EMAIL
    });

    const doc = await UserModel.findById(new Types.ObjectId(DEV_USER_ID)).lean();
    expect(doc).not.toBeNull();
    expect(doc!.emailAddress).toBe(DEV_USER_EMAIL);

    const collections = await CollectionModel.find({
      owner: new Types.ObjectId(DEV_USER_ID)
    }).lean();
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("Main Collection");
    expect(collections[0].isActive).toBe(true);
  });

  it("is idempotent across repeated sign-ins", async () => {
    await provisionDevUser();
    await provisionDevUser();

    expect(await UserModel.countDocuments({ _id: new Types.ObjectId(DEV_USER_ID) })).toBe(1);
    expect(
      await CollectionModel.countDocuments({ owner: new Types.ObjectId(DEV_USER_ID) })
    ).toBe(1);
  });

  it("scopes routes to the dev user once signed in", async () => {
    await provisionDevUser();
    setTestUser(DEV_USER_ID);

    const res = await listSummaries(jsonRequest("/api/collections/summaries", "GET"));
    expect(res.status).toBe(200);

    const { collections } = await res.json();
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("Main Collection");
    expect(String(collections[0].owner)).toBe(DEV_USER_ID);
  });
});
