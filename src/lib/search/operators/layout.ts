import { SearchOperatorConfig } from '../types';

/**
 * Layout: layout:transform, layout:modal_dfc
 */
export const layoutOperator: SearchOperatorConfig = {
  aliases: ['layout'],
  buildQuery: (value) => {
    return { layout: value.toLowerCase() };
  }
};
