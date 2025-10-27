/**
 * Configuration for sorting fields.
 * Defines how each field should be sorted, including custom logic for complex fields.
 */

export interface SortConfig {
  // The field name to sort by
  field: string;
  // Whether this field requires custom sorting (using aggregation pipeline)
  useAggregation?: boolean;
  // Function to build aggregation pipeline stages for custom sorting
  buildAggregationSort?: (direction: 1 | -1) => any[];
}

/**
 * Sort configurations for each supported field
 */
export const sortConfigs: Record<string, SortConfig> = {
  name: {
    field: 'name',
  },
  
  cmc: {
    field: 'cmc',
  },
  
  power: {
    field: 'power',
    useAggregation: true,
    buildAggregationSort: (direction) => [
      {
        $addFields: {
          // Convert power to number, use -1 for non-numeric values
          powerNumeric: {
            $cond: {
              if: { $regexMatch: { input: '$power', regex: /^[0-9]+$/ } },
              then: { $toInt: '$power' },
              else: direction === 1 ? -1 : 999999 // Non-numeric first if asc, last if desc
            }
          }
        }
      },
      {
        $sort: { powerNumeric: direction }
      }
    ]
  },
  
  toughness: {
    field: 'toughness',
    useAggregation: true,
    buildAggregationSort: (direction) => [
      {
        $addFields: {
          // Convert toughness to number, use -1 for non-numeric values
          toughnessNumeric: {
            $cond: {
              if: { $regexMatch: { input: '$toughness', regex: /^[0-9]+$/ } },
              then: { $toInt: '$toughness' },
              else: direction === 1 ? -1 : 999999 // Non-numeric first if asc, last if desc
            }
          }
        }
      },
      {
        $sort: { toughnessNumeric: direction }
      }
    ]
  },
  
  rarity: {
    field: 'rarity',
    useAggregation: true,
    buildAggregationSort: (direction) => {
      const rarityOrder = ['common', 'uncommon', 'rare', 'mythic'];
      return [
        {
          $addFields: {
            rarityOrder: {
              $indexOfArray: [rarityOrder, '$rarity']
            }
          }
        },
        {
          $sort: { rarityOrder: direction }
        }
      ];
    }
  },
  
  set: {
    field: 'set',
  },
  
  color: {
    field: 'colors',
    useAggregation: true,
    buildAggregationSort: (direction) => buildColorSortPipeline('colors', direction)
  },
  
  identity: {
    field: 'color_identity',
    useAggregation: true,
    buildAggregationSort: (direction) => buildColorSortPipeline('color_identity', direction)
  }
};

/**
 * Define the color combination order (WUBRG)
 */
const COLOR_COMBINATION_ORDER = [
  ['W'],
  ['U'],
  ['B'],
  ['R'],
  ['G'],
  ['W', 'U'],
  ['W', 'B'],
  ['W', 'R'],
  ['W', 'G'],
  ['U', 'B'],
  ['U', 'R'],
  ['U', 'G'],
  ['B', 'R'],
  ['B', 'G'],
  ['R', 'G'],
  ['W', 'U', 'B'],
  ['W', 'U', 'R'],
  ['W', 'U', 'G'],
  ['W', 'B', 'R'],
  ['W', 'B', 'G'],
  ['W', 'R', 'G'],
  ['U', 'B', 'R'],
  ['U', 'B', 'G'],
  ['U', 'R', 'G'],
  ['B', 'R', 'G'],
  ['W', 'U', 'B', 'R'],
  ['W', 'U', 'B', 'G'],
  ['W', 'U', 'R', 'G'],
  ['W', 'B', 'R', 'G'],
  ['U', 'B', 'R', 'G'],
  ['W', 'U', 'B', 'R', 'G'],
  [] // colorless
];

/**
 * Build an aggregation pipeline for sorting by color or color identity
 */
function buildColorSortPipeline(fieldName: string, direction: 1 | -1): any[] {
  const fieldPath = `$${fieldName}`;
  const sortedFieldName = `sorted_${fieldName}`;
  const keyFieldName = `${fieldName}_key`;
  const indexFieldName = `${fieldName}_order_index`;
  const finalFieldName = `final_${fieldName}_order`;

  return [
    {
      $addFields: {
        // Sort colors in WUBRG order first
        [sortedFieldName]: {
          $cond: {
            if: { $or: [{ $eq: [fieldPath, null] }, { $eq: [fieldPath, []] }] },
            then: [],
            else: {
              $let: {
                vars: {
                  colorOrder: ['W', 'U', 'B', 'R', 'G']
                },
                in: {
                  $filter: {
                    input: '$$colorOrder',
                    as: 'color',
                    cond: { $in: ['$$color', fieldPath] }
                  }
                }
              }
            }
          }
        }
      }
    },
    {
      $addFields: {
        // Create a sortable string from the sorted colors array
        [keyFieldName]: {
          $cond: {
            if: { $eq: [`$${sortedFieldName}`, []] },
            then: '', // colorless
            else: { $reduce: {
              input: `$${sortedFieldName}`,
              initialValue: '',
              in: { $concat: ['$$value', '$$this'] }
            }}
          }
        },
        // Find the index in our color order
        [indexFieldName]: {
          $indexOfArray: [
            COLOR_COMBINATION_ORDER.map(colors => colors.join('')),
            {
              $cond: {
                if: { $eq: [`$${sortedFieldName}`, []] },
                then: '',
                else: { $reduce: {
                  input: `$${sortedFieldName}`,
                  initialValue: '',
                  in: { $concat: ['$$value', '$$this'] }
                }}
              }
            }
          ]
        }
      }
    },
    {
      $addFields: {
        // If not found in our list, put it at the end (or beginning if desc)
        [finalFieldName]: {
          $cond: {
            if: { $eq: [`$${indexFieldName}`, -1] },
            then: direction === 1 ? 999999 : -1,
            else: `$${indexFieldName}`
          }
        }
      }
    },
    {
      $sort: { [finalFieldName]: direction }
    }
  ];
}


/**
 * Get the list of valid sort field names
 */
export function getValidSortFields(): string[] {
  return Object.keys(sortConfigs);
}

/**
 * Get sort configuration for a field
 */
export function getSortConfig(field: string): SortConfig | null {
  return sortConfigs[field] || null;
}
