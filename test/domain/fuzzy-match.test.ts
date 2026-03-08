import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '../../src/domain/world/fuzzy-match.js';

describe('fuzzyMatch', () => {
    it('returns null for empty query', () => {
        expect(fuzzyMatch('', 'hello')).toBeNull();
    });

    it('returns null when query does not match', () => {
        expect(fuzzyMatch('xyz', 'hello')).toBeNull();
    });

    it('matches exact string', () => {
        const result = fuzzyMatch('hello', 'hello');
        expect(result).not.toBeNull();
        expect(result!.indices).toEqual([0, 1, 2, 3, 4]);
    });

    it('matches case-insensitively', () => {
        const result = fuzzyMatch('HEL', 'hello');
        expect(result).not.toBeNull();
        expect(result!.indices).toEqual([0, 1, 2]);
    });

    it('matches subsequence', () => {
        const result = fuzzyMatch('fb', 'FooBar');
        expect(result).not.toBeNull();
        expect(result!.indices).toEqual([0, 3]);
    });

    it('gives first-char bonus', () => {
        const matchFirst = fuzzyMatch('f', 'foo');
        const matchMiddle = fuzzyMatch('o', 'foo');
        expect(matchFirst!.score).toBeGreaterThan(matchMiddle!.score);
    });

    it('gives consecutive bonus', () => {
        const consecutive = fuzzyMatch('he', 'hello');
        const nonConsecutive = fuzzyMatch('ho', 'hello');
        expect(consecutive!.score).toBeGreaterThan(nonConsecutive!.score);
    });

    it('gives word boundary bonus', () => {
        const boundary = fuzzyMatch('b', 'foo_bar');
        expect(boundary).not.toBeNull();
        // 'b' matches at index 4, which is after '_'
        expect(boundary!.indices).toEqual([4]);
        expect(boundary!.score).toBeGreaterThan(0);
    });

    it('gives camelCase bonus', () => {
        const result = fuzzyMatch('b', 'fooBar');
        expect(result).not.toBeNull();
        expect(result!.indices).toEqual([3]);
    });

    it('penalizes excess characters in target', () => {
        const short = fuzzyMatch('d', 'Docs');
        const long = fuzzyMatch('d', 'Development');
        expect(short!.score).toBeGreaterThan(long!.score);
    });

    it('scores exact match higher than fuzzy', () => {
        const exact = fuzzyMatch('do', 'Docs');
        const fuzzy = fuzzyMatch('do', 'DevOps');
        expect(exact!.score).toBeGreaterThan(fuzzy!.score);
    });

    it('handles single character targets', () => {
        const result = fuzzyMatch('a', 'a');
        expect(result).not.toBeNull();
        expect(result!.score).toBeGreaterThan(0);
    });

    it('returns null when query is longer than target with no match', () => {
        expect(fuzzyMatch('abcdef', 'abc')).toBeNull();
    });
});
