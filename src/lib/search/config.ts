import { SearchOperatorConfig } from "./types";
import {
  colorOperator,
  identityOperator,
  typeOperator,
  oracleOperator,
  nameOperator,
  flavornameOperator,
  manavalueOperator,
  powerOperator,
  toughnessOperator,
  loyaltyOperator,
  setOperator,
  rarityOperator,
  keywordOperator,
  layoutOperator,
  excludeOperator,
  langOperator
} from "./operators";

/**
 * Search operator definitions.
 * Each operator can have multiple aliases and defines how to build a MongoDB query.
 */
export const searchOperators: Record<string, SearchOperatorConfig> = {
  color: colorOperator,
  identity: identityOperator,
  type: typeOperator,
  oracle: oracleOperator,
  name: nameOperator,
  flavorname: flavornameOperator,
  manavalue: manavalueOperator,
  power: powerOperator,
  toughness: toughnessOperator,
  loyalty: loyaltyOperator,
  set: setOperator,
  rarity: rarityOperator,
  keyword: keywordOperator,
  layout: layoutOperator,
  exclude: excludeOperator,
  lang: langOperator
};

/**
 * Find the config for a given search key
 */
export function findOperatorConfig(key: string): SearchOperatorConfig | null {
  for (const config of Object.values(searchOperators)) {
    if (config.aliases.includes(key.toLowerCase())) {
      return config;
    }
  }
  return null;
}
