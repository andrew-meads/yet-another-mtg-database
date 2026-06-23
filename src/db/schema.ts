import mongoose, { Model, Schema, Types } from "mongoose";
import { MtgCard } from "@/types/MtgCard";
import { Tag } from "@/types/Tag";
import { User } from "@/types/User";
import { SetSvg } from "@/types/SetSvg";

// ---------------------------------------------------------------------------
// Mongoose document shapes (ObjectId-typed; the plain TS interfaces in
// src/types use string ids and are the DTO source of truth).
// ---------------------------------------------------------------------------

interface PhysicalCardDoc {
  owner: Types.ObjectId;
  cardId: string;
  collectionId: Types.ObjectId;
  deckId?: Types.ObjectId | null;
  notes?: string;
  tags?: string[];
}

interface CollectionDoc {
  name: string;
  description: string;
  isActive?: boolean;
  owner: Types.ObjectId;
}

interface DeckColumnDoc {
  _id?: Types.ObjectId;
  cards: Types.ObjectId[];
}

interface DeckSectionDoc {
  _id?: Types.ObjectId;
  name: string;
  columns: DeckColumnDoc[];
}

interface DeckDoc {
  name: string;
  description: string;
  owner: Types.ObjectId;
  sections: DeckSectionDoc[];
}

const userSchema = new Schema<User>(
  {
    emailAddress: { type: String, required: true, unique: true }
  },
  { strict: true }
);

// Each document in the "cards" collection represents a Magic: The Gathering card
// (Scryfall reference data). The model is named CardData to disambiguate it from
// PhysicalCard (physical copies), but the underlying collection stays "cards".
const cardSchema = new Schema<MtgCard>(
  {
    id: { type: String, required: true, unique: true },
    lang: { type: String, required: true },
    tcgplayer_id: Number,
    layout: { type: String, required: true },
    oracle_id: String,

    all_parts: [
      {
        id: { type: String, required: true },
        component: { type: String, required: true },
        name: { type: String, required: true },
        type_line: { type: String, required: true },
        uri: { type: String, required: true }
      }
    ],

    card_faces: [
      {
        layout: String,
        oracle_id: String,

        cmc: Number,
        color_indicator: [String],
        colors: [String],
        loyalty: String,
        mana_cost: String,
        name: { type: String, required: true },
        oracle_text: String,
        power: String,
        toughness: String,
        type_line: String,

        flavor_text: String,
        image_uris: {
          png: String,
          border_crop: String,
          art_crop: String,
          large: String,
          normal: String,
          small: String
        }
      }
    ],

    cmc: { type: Number, required: true },
    colors: [String],
    color_indicator: [String],
    color_identity: [String],
    keywords: [String],
    loyalty: String,
    mana_cost: String,
    name: { type: String, required: true },
    oracle_text: String,
    power: String,
    produced_mana: [String],
    toughness: String,
    type_line: { type: String, required: true },

    attraction_lights: [String],
    border_color: { type: String, required: true },
    collector_number: { type: String, required: true },
    finishes: [String],
    flavor_name: String,
    flavor_text: String,
    illustration_id: String,
    image_status: { type: String, required: true },
    image_uris: {
      png: String,
      border_crop: String,
      art_crop: String,
      large: String,
      normal: String,
      small: String
    },
    rarity: { type: String, required: true },
    set_name: { type: String, required: true },
    set: { type: String, required: true }
  },
  { strict: true, collection: "cards" }
);

// A single physical card copy. Belongs to exactly one collection and optionally
// one deck. These back-references are the source of truth for membership.
const physicalCardSchema = new Schema<PhysicalCardDoc>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    cardId: { type: String, required: true },
    collectionId: { type: Schema.Types.ObjectId, ref: "Collection", required: true, index: true },
    deckId: { type: Schema.Types.ObjectId, ref: "Deck", default: null, index: true },
    notes: String,
    tags: [String]
  },
  { strict: true, timestamps: true }
);

// A collection holds physical cards. Membership is purely PhysicalCard.collectionId;
// the collection table groups + sorts deterministically, so there is no stored order.
const collectionSchema = new Schema<CollectionDoc>(
  {
    name: { type: String, required: true },
    description: { type: String, required: false, default: "" },
    isActive: Boolean,
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }
  },
  { strict: true, timestamps: true }
);

// A deck arranges physical cards into named sections, each with any number of
// (unnamed) columns. Columns are ordered lists of PhysicalCard ids; the deckId
// back-reference is kept in sync with these arrays.
const deckColumnSchema = new Schema<DeckColumnDoc>({
  cards: [{ type: Schema.Types.ObjectId, ref: "PhysicalCard" }]
});

const deckSectionSchema = new Schema<DeckSectionDoc>({
  name: { type: String, required: true },
  columns: [deckColumnSchema]
});

const deckSchema = new Schema<DeckDoc>(
  {
    name: { type: String, required: true },
    description: { type: String, required: false, default: "" },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sections: [deckSectionSchema]
  },
  { strict: true, timestamps: true }
);

// Tag schema: each tag is just a string
export const TagSchema = new Schema<Tag>({
  label: { type: String, required: true, unique: true }
});

export const SetSvgSchema = new Schema<SetSvg>({
  setCode: { type: String, required: true, unique: true },
  svgContent: { type: String, required: true }
});

export const UserModel = (mongoose.models.User ||
  mongoose.model<User>("User", userSchema)) as Model<User>;

export const TagModel = (mongoose.models.Tag ||
  mongoose.model<Tag>("Tag", TagSchema)) as Model<Tag>;

export const CardData = (mongoose.models.CardData ||
  mongoose.model<MtgCard>("CardData", cardSchema)) as Model<MtgCard>;

export const PhysicalCardModel = (mongoose.models.PhysicalCard ||
  mongoose.model<PhysicalCardDoc>("PhysicalCard", physicalCardSchema)) as Model<PhysicalCardDoc>;

export const CollectionModel = (mongoose.models.Collection ||
  mongoose.model<CollectionDoc>("Collection", collectionSchema)) as Model<CollectionDoc>;

export const DeckModel = (mongoose.models.Deck ||
  mongoose.model<DeckDoc>("Deck", deckSchema)) as Model<DeckDoc>;

export const SetSvgModel = (mongoose.models.SetSvg ||
  mongoose.model<SetSvg>("SetSvg", SetSvgSchema)) as Model<SetSvg>;
