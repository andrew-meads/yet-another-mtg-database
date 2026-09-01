import { SearchOperatorConfig } from "../types";

/**
 * Release-date search on the "YYYY-MM-DD" `released_at` string field:
 *   year:2020, year>=2020, date<=2019-07-12
 *
 * A bare 4-digit value is treated as a whole year (year:2020 = any date inside
 * 2020); a full YYYY-MM-DD value compares exactly. String comparison is safe
 * because the format is lexicographically ordered. Cards without a
 * `released_at` (imported before the field existed and not yet backfilled)
 * never match.
 */
export const yearOperator: SearchOperatorConfig = {
  aliases: ["year", "date"],
  buildQuery: (value, operator) => {
    const op = operator || "=";

    if (/^\d{4}$/.test(value)) {
      const year = value;
      const nextYear = String(Number(value) + 1);
      switch (op) {
        case "=":
          return { released_at: { $gte: year, $lt: nextYear } };
        case ">=":
          return { released_at: { $gte: year } };
        case ">":
          return { released_at: { $gte: nextYear } };
        case "<=":
          return { released_at: { $lt: nextYear } };
        case "<":
          return { released_at: { $lt: year } };
        default:
          return null;
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      switch (op) {
        case "=":
          return { released_at: value };
        case ">=":
          return { released_at: { $gte: value } };
        case ">":
          return { released_at: { $gt: value } };
        case "<=":
          return { released_at: { $lte: value } };
        case "<":
          return { released_at: { $lt: value } };
        default:
          return null;
      }
    }

    return null;
  }
};
