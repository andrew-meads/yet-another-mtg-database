// Define TypeScript interface for the Card document
export interface MtgCard {
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
    mana_cost?: string;
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

/**
 * The subset of MtgCard fields the client actually renders, served by the
 * collection/deck/locations detail endpoints (see SLIM_CARD_PROJECTION in
 * src/lib/server/cardDetails.ts — keep the two in sync). A full MtgCard is
 * structurally assignable to SlimMtgCard, so full-card producers (search page,
 * scan, basic lands) still flow into slim-typed consumers.
 */
export type SlimMtgCard = Pick<
  MtgCard,
  | "id"
  | "name"
  | "flavor_name"
  | "layout"
  | "oracle_id"
  | "mana_cost"
  | "cmc"
  | "type_line"
  | "oracle_text"
  | "flavor_text"
  | "power"
  | "toughness"
  | "loyalty"
  | "set"
  | "set_name"
  | "collector_number"
  | "rarity"
  | "image_uris"
  | "card_faces"
>;
