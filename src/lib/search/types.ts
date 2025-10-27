/**
 * Configuration for a search operator
 */
export interface SearchOperatorConfig {
  // List of aliases for this operator (e.g., ['c', 'color'])
  aliases: string[];
  
  // Function that converts the search value into a MongoDB query fragment
  buildQuery: (value: string, operator?: string) => any;
  
  // Optional validator
  validate?: (value: string) => boolean;
}
