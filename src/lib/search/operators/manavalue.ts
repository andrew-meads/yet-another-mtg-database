import { parseComparison, parseEvenOdd } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Mana value: mv=3, mv>=5, mv:even
 */
export const manavalueOperator: SearchOperatorConfig = {
  aliases: ['mv', 'manavalue', 'cmc'],
  buildQuery: (value, operator) => {
    // Handle even/odd
    const evenOdd = parseEvenOdd(value);
    if (evenOdd) {
      return { cmc: evenOdd };
    }
    
    // Handle numeric comparison
    const { operator: mongoOp, value: num } = parseComparison(
      operator ? `${operator}${value}` : value
    );
    return { cmc: { [mongoOp]: num } };
  }
};
