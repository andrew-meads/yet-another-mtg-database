import { buildNumericStringComparison } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Power: pow>=5, pow>tou
 */
export const powerOperator: SearchOperatorConfig = {
  aliases: ['pow', 'power'],
  buildQuery: (value, operator) => {
    const isNumeric = /^-?\d+$/.test(value.trim());

    // For equals / not equals with non-numeric input, do string comparison
    if (!isNumeric && (operator === '=' || operator === '!=')) {
      if (operator === '=') return { power: value };
      return { power: { $ne: value } };
    }

    if (!isNumeric) return null; // unsupported non-numeric with >,<,>=,<=

    const num = parseInt(value, 10);
    return buildNumericStringComparison('power', operator || '=', num);
  }
};
