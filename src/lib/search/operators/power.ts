import { parseComparison } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Power: pow>=5, pow>tou
 */
export const powerOperator: SearchOperatorConfig = {
  aliases: ['pow', 'power'],
  buildQuery: (value, operator) => {
    // TODO: Handle power>toughness comparisons
    const { operator: mongoOp, value: num } = parseComparison(
      operator ? `${operator}${value}` : value
    );
    return { power: String(num) }; // Power is stored as string
  }
};
