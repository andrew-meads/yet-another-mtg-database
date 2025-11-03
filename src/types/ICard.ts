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