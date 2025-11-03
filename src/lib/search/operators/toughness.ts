import { buildNumericStringComparison } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Toughness: tou<=2
 */
export const toughnessOperator: SearchOperatorConfig = {
  aliases: ['tou', 'toughness'],
  buildQuery: (value, operator) => {
    const isNumeric = /^-?\d+$/.test(value.trim());

    if (!isNumeric && (operator === '=' || operator === '!=')) {
      if (operator === '=') return { toughness: value };
      return { toughness: { $ne: value } };
    }

    if (!isNumeric) return null;

    const num = parseInt(value, 10);
    return buildNumericStringComparison('toughness', operator || '=', num);
  }
};
