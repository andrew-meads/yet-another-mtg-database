import { parseComparison } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Loyalty: loy=3
 */
export const loyaltyOperator: SearchOperatorConfig = {
  aliases: ['loy', 'loyalty'],
  buildQuery: (value, operator) => {
    const { operator: mongoOp, value: num } = parseComparison(
      operator ? `${operator}${value}` : value
    );
    return { loyalty: String(num) }; // Loyalty is stored as string
  }
};
