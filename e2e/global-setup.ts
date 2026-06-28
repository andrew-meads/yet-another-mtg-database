import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { encode } from "next-auth/jwt";

const PORT = 27018;
const DB_NAME = "yamtgd-e2e";
const SECRET = "e2e-test-secret-do-not-use-in-prod";
const STORAGE_STATE = join(__dirname, ".auth", "storageState.json");
/** Ids of the seeded deck fixtures, shared with specs (e.g. dragDeck.spec.ts). */
const FIXTURES = join(__dirname, ".auth", "fixtures.json");

/** A couple of minimal-but-complete cards so the search page has results. */
const CARDS: Array<Record<string, unknown>> = [
  {
    id: "e2e-shivan",
    name: "Shivan Dragon",
    lang: "en",
    layout: "normal",
    cmc: 6,
    colors: ["R"],
    color_identity: ["R"],
    keywords: ["Flying"],
    type_line: "Creature — Dragon",
    oracle_text: "Flying. {R}: Shivan Dragon gets +1/+0 until end of turn.",
    power: "5",
    toughness: "5",
    rarity: "rare",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "171",
    border_color: "black",
    image_status: "highres_scan",
    finishes: ["nonfoil"]
  },
  {
    id: "e2e-llanowar",
    name: "Llanowar Elves",
    lang: "en",
    layout: "normal",
    cmc: 1,
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    type_line: "Creature — Elf Druid",
    oracle_text: "{T}: Add {G}.",
    power: "1",
    toughness: "1",
    rarity: "common",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "200",
    border_color: "black",
    image_status: "highres_scan",
    finishes: ["nonfoil"]
  },
  {
    // Only ever held as loose copies in the Main Collection — used by
    // dragCollectionPartial.spec.ts to drag a subset of a row's copies.
    id: "e2e-grizzly",
    name: "Grizzly Bears",
    lang: "en",
    layout: "normal",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    type_line: "Creature — Bear",
    oracle_text: "",
    power: "2",
    toughness: "2",
    rarity: "common",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "201",
    border_color: "black",
    image_status: "highres_scan",
    finishes: ["nonfoil"]
  },
  // The five Unhinged basic lands, so the deck-view "Add land" picker resolves
  // (getBasicLands queries set:"unh") and ephemeral-card drag specs have a card.
  ...["Plains", "Island", "Swamp", "Mountain", "Forest"].map((name, i) => ({
    id: `e2e-unh-${name.toLowerCase()}`,
    name,
    lang: "en",
    layout: "normal",
    cmc: 0,
    colors: [] as string[],
    color_identity: [] as string[],
    keywords: [] as string[],
    type_line: `Basic Land — ${name}`,
    oracle_text: "",
    rarity: "common",
    set: "unh",
    set_name: "Unhinged",
    collector_number: String(130 + i),
    border_color: "silver",
    image_status: "highres_scan",
    finishes: ["nonfoil"]
  }))
];

async function globalSetup() {
  const mongod = await MongoMemoryServer.create({ instance: { port: PORT, dbName: DB_NAME } });
  // Keep a reference alive for global-teardown.
  (globalThis as unknown as { __E2E_MONGOD__?: MongoMemoryServer }).__E2E_MONGOD__ = mongod;

  await mongoose.connect(mongod.getUri(DB_NAME));
  const db = mongoose.connection.db!;

  const userId = new Types.ObjectId();
  const collectionId = new Types.ObjectId();
  const sideCollectionId = new Types.ObjectId();
  await db.collection("users").insertOne({ _id: userId, emailAddress: "e2e@example.com" });
  await db.collection("collections").insertMany([
    {
      _id: collectionId,
      name: "Main Collection",
      description: "",
      isActive: true,
      owner: userId,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      // A second, non-active collection used by appbarPins.spec.ts for pin/unpin
      // and search → pinned-collection drop tests.
      _id: sideCollectionId,
      name: "Side Binder",
      description: "",
      isActive: false,
      owner: userId,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ] as never);
  await db.collection("cards").insertMany(CARDS as never);

  // A deck with one "Main" section, two columns: column A holds an ordered run of
  // three physical cards; column B is empty. Used by dragDeck.spec.ts to verify
  // that grabbing a card drags it plus every card on top of it.
  const deckId = new Types.ObjectId();
  const sectionId = new Types.ObjectId();
  const colAId = new Types.ObjectId();
  const colBId = new Types.ObjectId();
  const pcIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
  const cardIds = ["e2e-shivan", "e2e-llanowar", "e2e-shivan"];

  await db.collection("physicalcards").insertMany(
    pcIds.map((_id, i) => ({
      _id,
      owner: userId,
      cardId: cardIds[i],
      collectionId,
      deckId,
      createdAt: new Date(),
      updatedAt: new Date()
    })) as never
  );

  // Two loose (no-deck) copies of Grizzly Bears in the Main Collection so a partial-drag
  // test can split one copy off via the drag-count control.
  await db.collection("physicalcards").insertMany(
    [new Types.ObjectId(), new Types.ObjectId()].map((_id) => ({
      _id,
      owner: userId,
      cardId: "e2e-grizzly",
      collectionId,
      createdAt: new Date(),
      updatedAt: new Date()
    })) as never
  );

  await db.collection("decks").insertOne({
    _id: deckId,
    name: "Drag Test Deck",
    description: "",
    owner: userId,
    sections: [
      {
        _id: sectionId,
        name: "Main",
        columns: [
          { _id: colAId, cards: pcIds },
          { _id: colBId, cards: [] }
        ]
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // --- Dedicated fixtures for the cross-kind drag specs (dragCrossKind.spec.ts).
  // These entities are touched ONLY by that spec so they don't perturb the others.
  const ckTargetCollId = new Types.ObjectId(); // deck→collection target (starts empty)
  await db.collection("collections").insertOne({
    _id: ckTargetCollId,
    name: "CrossKind Target",
    description: "",
    isActive: false,
    owner: userId,
    createdAt: new Date(),
    updatedAt: new Date()
  } as never);

  // A loose Llanowar copy in the Main Collection — source for collection→deck.
  const ckLooseCardId = new Types.ObjectId();
  await db.collection("physicalcards").insertOne({
    _id: ckLooseCardId,
    owner: userId,
    cardId: "e2e-llanowar",
    collectionId,
    createdAt: new Date(),
    updatedAt: new Date()
  } as never);

  // Empty deck that receives search→deck and collection→deck drops (additive).
  const ckDeckId = new Types.ObjectId();
  await db.collection("decks").insertOne({
    _id: ckDeckId,
    name: "CrossKind Deck",
    description: "",
    owner: userId,
    sections: [{ name: "Main", columns: [{ cards: [] }] }],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // Deck holding one collection-backed card — source for deck→collection.
  const ckSourceDeckId = new Types.ObjectId();
  const ckDeckCardId = new Types.ObjectId();
  await db.collection("physicalcards").insertOne({
    _id: ckDeckCardId,
    owner: userId,
    cardId: "e2e-shivan",
    collectionId,
    deckId: ckSourceDeckId,
    createdAt: new Date(),
    updatedAt: new Date()
  } as never);
  await db.collection("decks").insertOne({
    _id: ckSourceDeckId,
    name: "CrossKind Source Deck",
    description: "",
    owner: userId,
    sections: [{ name: "Main", columns: [{ cards: [ckDeckCardId] }] }],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // --- Dedicated fixtures for the ephemeral drag specs (dragEphemeral.spec.ts).
  // An ephemeral (no-collection) basic land in its own deck, plus an empty "other"
  // deck used only as a no-op drop target.
  const ephDeckId = new Types.ObjectId();
  const ephSectionId = new Types.ObjectId();
  const ephSourceColId = new Types.ObjectId();
  const ephEmptyColId = new Types.ObjectId();
  const ephemeralCardId = new Types.ObjectId();
  await db.collection("physicalcards").insertOne({
    _id: ephemeralCardId,
    owner: userId,
    cardId: "e2e-unh-forest",
    collectionId: null,
    deckId: ephDeckId,
    createdAt: new Date(),
    updatedAt: new Date()
  } as never);
  await db.collection("decks").insertOne({
    _id: ephDeckId,
    name: "Ephemeral Deck",
    description: "",
    owner: userId,
    sections: [
      {
        _id: ephSectionId,
        name: "Main",
        columns: [
          { _id: ephSourceColId, cards: [ephemeralCardId] },
          { _id: ephEmptyColId, cards: [] }
        ]
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // Empty "other" deck — drop target proving ephemeral cards can't change decks.
  const otherDeckId = new Types.ObjectId();
  await db.collection("decks").insertOne({
    _id: otherDeckId,
    name: "Other Deck",
    description: "",
    owner: userId,
    sections: [{ name: "Main", columns: [{ cards: [] }] }],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await mongoose.disconnect();

  mkdirSync(dirname(FIXTURES), { recursive: true });
  writeFileSync(
    FIXTURES,
    JSON.stringify(
      {
        deckId: deckId.toString(),
        sectionId: sectionId.toString(),
        columnA: colAId.toString(),
        columnB: colBId.toString(),
        physicalCardIds: pcIds.map((id) => id.toString()),
        mainCollectionId: collectionId.toString(),
        sideCollectionId: sideCollectionId.toString(),
        // Cross-kind spec fixtures.
        ckDeckId: ckDeckId.toString(),
        ckSourceDeckId: ckSourceDeckId.toString(),
        ckDeckCardId: ckDeckCardId.toString(),
        ckTargetCollId: ckTargetCollId.toString(),
        // Ephemeral spec fixtures.
        ephDeckId: ephDeckId.toString(),
        ephSourceColId: ephSourceColId.toString(),
        ephEmptyColId: ephEmptyColId.toString(),
        ephemeralCardId: ephemeralCardId.toString(),
        otherDeckId: otherDeckId.toString()
      },
      null,
      2
    )
  );

  // Mint a NextAuth session cookie. getToken (proxy.ts) and the session callback
  // (auth.ts) read AUTH_SECRET and token._id, so this satisfies the auth gate.
  const token = await encode({
    token: {
      name: "E2E User",
      email: "e2e@example.com",
      sub: userId.toString(),
      _id: userId.toString()
    },
    secret: SECRET
  });

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(
    STORAGE_STATE,
    JSON.stringify(
      {
        cookies: [
          {
            name: "next-auth.session-token",
            value: token,
            domain: "localhost",
            path: "/",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
            expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24
          }
        ],
        origins: []
      },
      null,
      2
    )
  );
}

export default globalSetup;
