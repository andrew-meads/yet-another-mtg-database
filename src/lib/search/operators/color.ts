import { parseColors } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Color search: c:red, c:ur, c:azorius
 */
export const colorOperator: SearchOperatorConfig = {
  aliases: ['c', 'color'],
  buildQuery: (value, operator) => {
    const colors = parseColors(value);
    
    if (colors.length === 0) {
      // Colorless
      return { $or: [{ colors: { $exists: false } }, { colors: { $size: 0 } }] };
    }
    
    // =: exact color match (must have exactly these colors, no more, no less)
    if (operator === '=') {
      return {
        $and: [
          { colors: { $all: colors } },
          { colors: { $size: colors.length } }
        ]
      };
    }
    
    // Default behavior (no operator): card must have ALL specified colors (can have more)
    if (!operator) {
      return { colors: { $all: colors } };
    }
    
    // >=: at least these colors
    if (operator === '>=') {
      return { colors: { $all: colors } };
    }
    
    // <=: at most these colors (subset)
    if (operator === '<=') {
      return {
        $and: [
          { colors: { $not: { $elemMatch: { $nin: colors } } } },
          { colors: { $exists: true } }
        ]
      };
    }
    
    return { colors: { $all: colors } };
  }
};
