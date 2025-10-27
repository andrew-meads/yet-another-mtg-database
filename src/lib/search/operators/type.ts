import { escapeRegex } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Type search: t:creature, t:instant, t:legendary
 */
export const typeOperator: SearchOperatorConfig = {
  aliases: ['t', 'type'],
  buildQuery: (value) => {
    return { type_line: new RegExp(escapeRegex(value), 'i') };
  }
};
