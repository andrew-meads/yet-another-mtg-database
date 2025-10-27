import { SearchOperatorConfig } from '../types';

/**
 * Set: e:war, s:m21, set:neo
 */
export const setOperator: SearchOperatorConfig = {
  aliases: ['e', 's', 'set', 'edition'],
  buildQuery: (value) => {
    return { set: value.toLowerCase() };
  }
};
