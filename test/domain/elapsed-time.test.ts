import { describe, it, expect } from 'vitest';
import { formatElapsedTime } from '../../src/domain/elapsed-time.js';

describe('formatElapsedTime', () => {
    it('returns "0s" for negative values', () => {
        expect(formatElapsedTime(-1000)).toBe('0s');
    });

    it('returns "0s" for zero', () => {
        expect(formatElapsedTime(0)).toBe('0s');
    });

    // < 1 min: rounded seconds
    it('formats seconds below 1 minute', () => {
        expect(formatElapsedTime(5_000)).toBe('5s');
        expect(formatElapsedTime(30_000)).toBe('30s');
        expect(formatElapsedTime(59_000)).toBe('59s');
    });

    it('rounds fractional seconds', () => {
        expect(formatElapsedTime(5_500)).toBe('6s');
        expect(formatElapsedTime(29_400)).toBe('29s');
    });

    // < 10 min: half minutes
    it('formats half minutes below 10 minutes', () => {
        expect(formatElapsedTime(60_000)).toBe('1m');
        expect(formatElapsedTime(90_000)).toBe('1.5m');
        expect(formatElapsedTime(120_000)).toBe('2m');
        expect(formatElapsedTime(5 * 60_000)).toBe('5m');
        expect(formatElapsedTime(9.5 * 60_000)).toBe('9.5m');
    });

    // < 1 hr: rounded minutes
    it('formats rounded minutes below 1 hour', () => {
        expect(formatElapsedTime(10 * 60_000)).toBe('10m');
        expect(formatElapsedTime(23 * 60_000)).toBe('23m');
        expect(formatElapsedTime(59 * 60_000)).toBe('59m');
    });

    // < 10 hr: half hours
    it('formats half hours below 10 hours', () => {
        expect(formatElapsedTime(60 * 60_000)).toBe('1h');
        expect(formatElapsedTime(90 * 60_000)).toBe('1.5h');
        expect(formatElapsedTime(3 * 60 * 60_000)).toBe('3h');
        expect(formatElapsedTime(9.5 * 60 * 60_000)).toBe('9.5h');
    });

    // < 24 hr: rounded hours
    it('formats rounded hours below 24 hours', () => {
        expect(formatElapsedTime(10 * 60 * 60_000)).toBe('10h');
        expect(formatElapsedTime(23 * 60 * 60_000)).toBe('23h');
    });

    // < 10 days: half days
    it('formats half days below 10 days', () => {
        expect(formatElapsedTime(24 * 60 * 60_000)).toBe('1d');
        expect(formatElapsedTime(36 * 60 * 60_000)).toBe('1.5d');
        expect(formatElapsedTime(5 * 24 * 60 * 60_000)).toBe('5d');
    });

    // >= 10 days: rounded days
    it('formats rounded days for 10+ days', () => {
        expect(formatElapsedTime(10 * 24 * 60 * 60_000)).toBe('10d');
        expect(formatElapsedTime(12 * 24 * 60 * 60_000)).toBe('12d');
        expect(formatElapsedTime(100 * 24 * 60 * 60_000)).toBe('100d');
    });
});
