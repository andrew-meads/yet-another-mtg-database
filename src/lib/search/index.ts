/**
 * Search module for parsing Scryfall-like search queries
 * and converting them to MongoDB queries.
 * 
 * Usage:
 *   import { parseSearchQuery } from '@/lib/search';
 *   const mongoQuery = parseSearchQuery('c:red t:creature mv>=3');
 *   const cards = await Card.find(mongoQuery);
 */

export { parseSearchQuery, buildSearchQuery } from './queryBuilder';
export { tokenizeQuery, parseTerm } from './parser';
export { searchOperators, findOperatorConfig } from './config';
export { parseColors, parseComparison, parseEvenOdd } from './helpers';
export type { SearchOperatorConfig } from './types';
export type { ParsedTerm } from './parser';
