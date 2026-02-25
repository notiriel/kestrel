export interface FuzzyMatchResult {
    score: number;
    indices: number[];
}

/**
 * Fuzzy match a query against a target string.
 * Returns match score and matched character indices, or null if no match.
 *
 * Scoring:
 *   +10 for matching the first character of the target
 *   +8  for consecutive character matches
 *   +5  for matches after word boundaries or camelCase transitions
 *   +1  per matched character
 *   -0.5 penalty per excess character in target vs query
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
    if (query.length === 0) return null;

    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();
    const indices: number[] = [];

    let qi = 0;
    for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
        if (targetLower[ti] === queryLower[qi]) {
            indices.push(ti);
            qi++;
        }
    }

    if (qi !== queryLower.length) return null;

    let score = 0;
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i]!;
        score += 1; // per matched character

        if (idx === 0) {
            score += 10; // first char bonus
        }

        if (i > 0 && indices[i - 1]! + 1 === idx) {
            score += 8; // consecutive bonus
        }

        if (idx > 0) {
            const prev = target[idx - 1]!;
            const curr = target[idx]!;
            if (prev === '_' || prev === '-' || prev === ' ' || prev === '.') {
                score += 5; // word boundary bonus
            } else if (prev === prev.toLowerCase() && curr === curr.toUpperCase() && curr !== curr.toLowerCase()) {
                score += 5; // camelCase bonus
            }
        }
    }

    // Penalty for excess characters in target
    const excess = target.length - query.length;
    if (excess > 0) {
        score -= excess * 0.5;
    }

    return { score, indices };
}
