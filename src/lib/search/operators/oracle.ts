import { escapeRegex } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Oracle text search: o:flying, o:"draw a card"
 */
export const oracleOperator: SearchOperatorConfig = {
  aliases: ['o', 'oracle'],
  buildQuery: (value) => {
    return { oracle_text: new RegExp(escapeRegex(value), 'i') };
  }
};
