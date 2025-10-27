/**
 * Color abbreviations mapping
 */
const COLOR_MAP: Record<string, string[]> = {
  w: ['W'],
  u: ['U'],
  b: ['B'],
  r: ['R'],
  g: ['G'],
  white: ['W'],
  blue: ['U'],
  black: ['B'],
  red: ['R'],
  green: ['G'],
  c: [], // colorless
  colorless: [],
  // Guild names
  azorius: ['W', 'U'],
  dimir: ['U', 'B'],
  rakdos: ['B', 'R'],
  gruul: ['R', 'G'],
  selesnya: ['G', 'W'],
  orzhov: ['W', 'B'],
  izzet: ['U', 'R'],
  golgari: ['B', 'G'],
  boros: ['R', 'W'],
  simic: ['G', 'U'],
  // Shard names
  bant: ['G', 'W', 'U'],
  esper: ['W', 'U', 'B'],
  grixis: ['U', 'B', 'R'],
  jund: ['B', 'R', 'G'],
  naya: ['R', 'G', 'W'],
  // Wedge names
  abzan: ['W', 'B', 'G'],
  jeskai: ['U', 'R', 'W'],
  sultai: ['B', 'G', 'U'],
  mardu: ['R', 'W', 'B'],
  temur: ['G', 'U', 'R'],
};

/**
 * Parse a color string into an array of color codes.
 * Handles single letters, full names, and guild/shard names.
 * 
 * Examples:
 *   "red" => ["R"]
 *   "ur" => ["U", "R"]
 *   "azorius" => ["W", "U"]
 *   "wubr" => ["W", "U", "B", "R"]
 */
export function parseColors(colorString: string): string[] {
  const lower = colorString.toLowerCase();
  
  // Check if it's a named color set (guild, shard, etc.)
  if (COLOR_MAP[lower]) {
    return COLOR_MAP[lower];
  }
  
  // Parse individual color letters
  const colors: string[] = [];
  for (const char of lower) {
    if (COLOR_MAP[char]) {
      colors.push(...COLOR_MAP[char]);
    }
  }
  
  // Remove duplicates and return
  return [...new Set(colors)];
}

/**
 * Parse a comparison operator and number from a string.
 * 
 * Examples:
 *   ">=3" => { operator: "$gte", value: 3 }
 *   "<5" => { operator: "$lt", value: 5 }
 *   "3" => { operator: "$eq", value: 3 }
 */
export function parseComparison(value: string): {
  operator: string;
  value: number;
} {
  const match = value.match(/^(>=|<=|!=|>|<|=)?(.+)$/);
  if (!match) {
    return { operator: '$eq', value: parseInt(value) };
  }

  const [, op, numStr] = match;
  const num = parseInt(numStr);

  const operatorMap: Record<string, string> = {
    '>=': '$gte',
    '<=': '$lte',
    '>': '$gt',
    '<': '$lt',
    '=': '$eq',
    '!=': '$ne',
  };

  return {
    operator: operatorMap[op || '='] || '$eq',
    value: num,
  };
}

/**
 * Convert "even" or "odd" to a MongoDB modulo query
 */
export function parseEvenOdd(value: string): any {
  if (value.toLowerCase() === 'even') {
    return { $mod: [2, 0] };
  } else if (value.toLowerCase() === 'odd') {
    return { $mod: [2, 1] };
  }
  return null;
}

/**
 * Escape special regex characters
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
