import { escapeRegex } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Flavor name search: fn:godzilla, flavorname:"king of the monsters"
 * Searches only the flavor_name field (e.g., Godzilla series cards)
 */
export const flavornameOperator: SearchOperatorConfig = {
  aliases: ['fn', 'flavorname', 'flavor'],
  buildQuery: (value) => {
    return { flavor_name: new RegExp(escapeRegex(value), 'i') };
  }
};
