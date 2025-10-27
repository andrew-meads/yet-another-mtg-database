import { parseColors } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Color identity: id:esper, id:c
 */
export const identityOperator: SearchOperatorConfig = {
  aliases: ['id', 'identity'],
  buildQuery: (value, operator) => {
    const colors = parseColors(value);
    
    if (colors.length === 0) {
      return { $or: [{ color_identity: { $exists: false } }, { color_identity: { $size: 0 } }] };
    }
    
    // =: exact color identity match (must have exactly these colors, no more, no less)
    if (operator === '=') {
      return {
        $and: [
          { color_identity: { $all: colors } },
          { color_identity: { $size: colors.length } }
        ]
      };
    }
    
    // Default behavior (no operator): card must have ALL specified colors (can have more)
    if (!operator) {
      return { color_identity: { $all: colors } };
    }
    
    // >=: at least these colors
    if (operator === '>=') {
      return { color_identity: { $all: colors } };
    }
    
    // <=: at most these colors (subset)
    if (operator === '<=') {
      return {
        $and: [
          { color_identity: { $not: { $elemMatch: { $nin: colors } } } },
          { color_identity: { $exists: true } }
        ]
      };
    }
    
    return { color_identity: { $all: colors } };
  }
};
