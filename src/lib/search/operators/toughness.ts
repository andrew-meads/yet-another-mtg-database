import { parseComparison } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Toughness: tou<=2
 */
export const toughnessOperator: SearchOperatorConfig = {
  aliases: ['tou', 'toughness'],
  buildQuery: (value, operator) => {
    const { operator: mongoOp, value: num } = parseComparison(
      operator ? `${operator}${value}` : value
    );
    return { toughness: String(num) }; // Toughness is stored as string
  }
};
