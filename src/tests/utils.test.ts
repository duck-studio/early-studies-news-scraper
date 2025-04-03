import { describe, it, expect } from 'vitest';
import { getDateRange, getTbsString, getGeoParams, parseSerperDate } from '../utils';

describe('getDateRange', () => {
  it('should return correct date range for Past Week (default)', () => {
    const range = getDateRange('Past Week');
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    expect(range.end.getDate()).toBe(now.getDate());
    expect(range.start.getDate()).toBe(oneWeekAgo.getDate());
  });

  it('should return correct date range for Past Hour', () => {
    const range = getDateRange('Past Hour');
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Check that the dates are approximately one hour apart
    const diffInMs = range.end.getTime() - range.start.getTime();
    expect(diffInMs).toBeGreaterThanOrEqual(59 * 60 * 1000); // Allow 1 minute of execution time
    expect(diffInMs).toBeLessThanOrEqual(61 * 60 * 1000);
  });
});

describe('getTbsString', () => {
  it('should return correct TBS string for Past Week', () => {
    expect(getTbsString('Past Week')).toBe('qdr:w');
  });

  it('should return correct TBS string for Past Month', () => {
    expect(getTbsString('Past Month')).toBe('qdr:m');
  });

  it('should handle Custom TBS string properly', () => {
    const customTbs = 'tbs=cdr:1,cd_min:01/01/2023,cd_max:01/31/2023';
    expect(getTbsString('Custom', customTbs)).toBe('cdr:1,cd_min:01/01/2023,cd_max:01/31/2023');
  });
});

describe('getGeoParams', () => {
  it('should return correct parameters for US region', () => {
    const params = getGeoParams('US');
    expect(params.gl).toBe('us');
    expect(params.location).toBe('United States');
  });

  it('should return correct parameters for UK region', () => {
    const params = getGeoParams('UK');
    expect(params.gl).toBe('gb');
    expect(params.location).toBe('United Kingdom');
  });
});

describe('parseSerperDate', () => {
  it('should parse "X hours ago" format correctly', () => {
    const now = new Date();
    const result = parseSerperDate('2 hours ago');
    
    if (result) {
      // Allow for small timing differences during test execution
      const expectedTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const diffInMinutes = Math.abs((result.getTime() - expectedTime.getTime()) / (60 * 1000));
      expect(diffInMinutes).toBeLessThanOrEqual(5); // Within 5 minutes tolerance
    } else {
      // Test will fail if parseSerperDate returns null
      expect(result).not.toBeNull();
    }
  });

  it('should parse absolute date formats', () => {
    // This format depends on the current date, so create a date string in the expected format
    const testDate = new Date(2023, 7, 25); // August 25, 2023
    const dateString = '25 Aug 2023';
    
    const result = parseSerperDate(dateString);
    
    expect(result?.getFullYear()).toBe(2023);
    expect(result?.getMonth()).toBe(7); // Zero-based months (0-11)
    expect(result?.getDate()).toBe(25);
  });

  it('should return null for invalid date strings', () => {
    expect(parseSerperDate('not a date')).toBeNull();
    expect(parseSerperDate('')).toBeNull();
    expect(parseSerperDate(undefined as unknown as string)).toBeNull();
  });
});