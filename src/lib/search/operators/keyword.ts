import { escapeRegex } from '../helpers';
import { SearchOperatorConfig } from '../types';

/**
 * Keywords: kw:flying, keyword:haste
 */
export const keywordOperator: SearchOperatorConfig = {
  aliases: ['kw', 'keyword'],
  buildQuery: (value) => {
    return { keywords: new RegExp(escapeRegex(value), 'i') };
  }
};
