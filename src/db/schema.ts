import mongoose, { Model, Schema } from "mongoose";
import { MtgCard } from "@/types/MtgCard";
import { CardCollection } from "@/types/CardCollection";
import { Tag } from "@/types/Tag";
import { User } from "@/types/User";

const userSchema = new Schema<User>(
  {
    emailAddress: { type: String, required: true, unique: true }
  },
  { strict: true }
);

// Each document in the "cards" collection represents a Magic: The Gathering card
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
  { strict: true }
);

const collectionSchema = new Schema<CardCollection>(
  {
    name: { type: String, required: true },
    description: { type: String, required: false, default: "" },
    isActive: Boolean,
    collectionType: { type: String, required: true, enum: ["collection", "wishlist", "deck"] },
    cards: [
      {
        cardId: { type: String, required: true },
        quantity: { type: Number, required: true },
        notes: String,
        tags: [String]
      }
    ]
  },
  { strict: true, timestamps: true }
);

// Tag schema: each tag is just a string
export const TagSchema = new Schema<Tag>({
  label: { type: String, required: true, unique: true }
});

export const UserModel = (mongoose.models.User ||
  mongoose.model<User>("User", userSchema)) as Model<User>;

export const TagModel = (mongoose.models.Tag ||
  mongoose.model<Tag>("Tag", TagSchema)) as Model<Tag>;

// Prevent model recompilation during hot reload in development
export const Card = (mongoose.models.Card ||
  mongoose.model<MtgCard>("Card", cardSchema)) as Model<MtgCard>;

export const CardCollectionModel = (mongoose.models.CardCollection ||
  mongoose.model<CardCollection>("CardCollection", collectionSchema)) as Model<CardCollection>;
