import { SearchOperatorConfig } from '../types';

/**
 * Rarity: r:mythic, r:common
 */
export const rarityOperator: SearchOperatorConfig = {
  aliases: ['r', 'rarity'],
  buildQuery: (value, operator) => {
    const rarityOrder = ['common', 'uncommon', 'rare', 'mythic'];
    const lower = value.toLowerCase();
    
    if (!operator || operator === '=') {
      return { rarity: lower };
    }
    
    const index = rarityOrder.indexOf(lower);
    if (index === -1) {
      return { rarity: lower };
    }
    
    if (operator === '>=') {
      return { rarity: { $in: rarityOrder.slice(index) } };
    }
    
    if (operator === '<=') {
      return { rarity: { $in: rarityOrder.slice(0, index + 1) } };
    }
    
    if (operator === '>') {
      return { rarity: { $in: rarityOrder.slice(index + 1) } };
    }
    
    if (operator === '<') {
      return { rarity: { $in: rarityOrder.slice(0, index) } };
    }
    
    return { rarity: lower };
  }
};
