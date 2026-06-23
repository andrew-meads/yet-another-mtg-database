import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { CardData, CollectionModel, DeckModel, PhysicalCardModel, UserModel } from "@/db/schema";
import { MtgCard } from "@/types/MtgCard";

/** Point getServerSession at a given user id (or null for "signed out"). */
export function setTestUser(userId: string | null) {
  const g = globalThis as unknown as { __authState?: { session: unknown } };
  g.__authState ??= { session: null };
  g.__authState.session = userId
    ? { user: { _id: userId, email: "test@example.com", name: "Test User" } }
    : null;
}

/** Build a minimal-but-valid CardData doc (all schema-required fields present). */
export function makeCard(overrides: Partial<MtgCard> = {}): MtgCard {
  const id = overrides.id ?? new Types.ObjectId().toString();
  return {
    id,
    lang: "en",
    layout: "normal",
    cmc: 3,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    name: "Test Card",
    type_line: "Creature — Goblin",
    oracle_text: "Haste",
    power: "2",
    toughness: "2",
    border_color: "black",
    collector_number: "1",
    finishes: ["nonfoil"],
    image_status: "highres_scan",
    rarity: "common",
    set_name: "Test Set",
    set: "tst",
    ...overrides
  } as MtgCard;
}

/** Seed a whitelisted user and return its string id. */
export async function seedUser(email = "test@example.com") {
  const user = await UserModel.create({ emailAddress: email });
  return user._id.toString();
}

export async function seedCard(overrides: Partial<MtgCard> = {}) {
  const card = makeCard(overrides);
  await CardData.create(card);
  return card;
}

export async function seedCollection(
  owner: string,
  fields: { name?: string; description?: string; isActive?: boolean } = {}
) {
  const coll = await CollectionModel.create({
    name: fields.name ?? "Test Collection",
    description: fields.description ?? "",
    isActive: fields.isActive,
    owner: new Types.ObjectId(owner)
  });
  return coll._id.toString();
}

/** Create a deck with a single "Main" section containing one empty column. */
export async function seedDeck(owner: string, name = "Test Deck") {
  const deck = await DeckModel.create({
    name,
    description: "",
    owner: new Types.ObjectId(owner),
    sections: [{ name: "Main", columns: [{ cards: [] }] }]
  });
  return deck;
}

export async function seedPhysicalCard(
  owner: string,
  cardId: string,
  collectionId: string,
  fields: { deckId?: string | null; notes?: string; tags?: string[] } = {}
) {
  const pc = await PhysicalCardModel.create({
    owner: new Types.ObjectId(owner),
    cardId,
    collectionId: new Types.ObjectId(collectionId),
    deckId: fields.deckId ? new Types.ObjectId(fields.deckId) : null,
    notes: fields.notes,
    tags: fields.tags
  });
  return pc._id.toString();
}

/** Construct a NextRequest with an optional JSON body. */
export function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return new NextRequest(
    `http://localhost${url}`,
    init as ConstructorParameters<typeof NextRequest>[1]
  );
}

/** Build the `{ params }` second-arg App Router handlers receive (Next 16: async params). */
export function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}
