import { escapeRegex } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Name search: name:lightning, name:"black lotus"
 */
export const nameOperator: SearchOperatorConfig = {
  aliases: ['name'],
  buildQuery: (value) => {
    return { name: new RegExp(escapeRegex(value), 'i') };
  }
};
