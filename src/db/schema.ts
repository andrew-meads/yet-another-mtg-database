import mongoose, { Model } from "mongoose";
const Schema = mongoose.Schema;

// Define TypeScript interface for the Card document
export interface ICard {
  id: string;
  lang: string;
  tcgplayer_id?: number;
  layout: string;
  oracle_id?: string;

  all_parts?: Array<{
    id: string;
    component: string;
    name: string;
    type_line: string;
    uri: string;
  }>;

  card_faces?: Array<{
    layout?: string;
    oracle_id?: string;
    cmc?: number;
    color_indicator?: string[];
    colors?: string[];
    loyalty?: string;
    mana_cost: string;
    name: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    type_line?: string;
    flavor_text?: string;
    image_uris?: {
      png?: string;
      border_crop?: string;
      art_crop?: string;
      large?: string;
      normal?: string;
      small?: string;
    };
  }>;

  cmc: number;
  colors?: string[];
  color_indicator?: string[];
  color_identity?: string[];
  keywords?: string[];
  loyalty?: string;
  mana_cost?: string;
  name: string;
  oracle_text?: string;
  power?: string;
  produced_mana?: string[];
  toughness?: string;
  type_line: string;

  attraction_lights?: string[];
  border_color: string;
  collector_number: string;
  finishes?: string[];
  flavor_name?: string;
  flavor_text?: string;
  illustration_id?: string;
  image_status: string;
  image_uris?: {
    png?: string;
    border_crop?: string;
    art_crop?: string;
    large?: string;
    normal?: string;
    small?: string;
  };
  rarity: string;
  set_name: string;
  set: string;
}

// Define your schema
const cardSchema = new Schema<ICard>(
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
        mana_cost: { type: String, required: true },
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

// Prevent model recompilation during hot reload in development
export const Card = (mongoose.models.Card ||
  mongoose.model<ICard>("Card", cardSchema)) as Model<ICard>;
