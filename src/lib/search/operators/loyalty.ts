import { buildNumericStringComparison } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Loyalty: loy=3
 */
export const loyaltyOperator: SearchOperatorConfig = {
  aliases: ['loy', 'loyalty'],
  buildQuery: (value, operator) => {
    const isNumeric = /^-?\d+$/.test(value.trim());

    if (!isNumeric && (operator === '=' || operator === '!=')) {
      if (operator === '=') return { loyalty: value };
      return { loyalty: { $ne: value } };
    }

    if (!isNumeric) return null;

    const num = parseInt(value, 10);
    return buildNumericStringComparison('loyalty', operator || '=', num);
  }
};
