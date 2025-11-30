import { getNextRunDate, formatNextRunDate } from './cron-utils';

describe('CronUtils', () => {
  describe('getNextRunDate', () => {
    // Tests cron expression parsing for job scheduling

    beforeEach(() => {
      // Use a fixed date for consistent tests
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T10:30:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return next run date for every minute cron', () => {
      // * * * * * = every minute
      const nextDate = getNextRunDate('* * * * *');
      expect(nextDate).toBeInstanceOf(Date);
      expect(nextDate?.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return next run date for hourly cron', () => {
      // 0 * * * * = every hour at minute 0
      const nextDate = getNextRunDate('0 * * * *');
      expect(nextDate).toBeInstanceOf(Date);
      // Just verify it's in the future
      expect(nextDate?.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return next run date for daily cron', () => {
      // 0 9 * * * = every day at 9:00 AM UTC
      const nextDate = getNextRunDate('0 9 * * *');
      expect(nextDate).toBeInstanceOf(Date);
      // Check UTC hours since cron uses UTC
      expect(nextDate?.getUTCHours()).toBe(9);
      expect(nextDate?.getUTCMinutes()).toBe(0);
    });

    it('should return next run date for weekly cron', () => {
      // 0 9 * * 1 = every Monday at 9:00 AM
      const nextDate = getNextRunDate('0 9 * * 1');
      expect(nextDate).toBeInstanceOf(Date);
      expect(nextDate?.getDay()).toBe(1); // Monday
    });

    it('should return next run date for monthly cron', () => {
      // 0 0 1 * * = first day of every month at midnight
      const nextDate = getNextRunDate('0 0 1 * *');
      expect(nextDate).toBeInstanceOf(Date);
      expect(nextDate?.getDate()).toBe(1);
    });

    it('should return null for null input', () => {
      // Null cron expressions should return null
      expect(getNextRunDate(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(getNextRunDate(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(getNextRunDate('')).toBeNull();
    });

    it('should return null for invalid cron expression', () => {
      // Invalid cron should return null, not throw
      // Suppress expected console.error from cron parser
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(getNextRunDate('invalid cron')).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should handle cron with fewer fields', () => {
      // The cron parser may accept fewer fields with defaults
      // Just verify it doesn't crash
      const result = getNextRunDate('* * *');
      // Result may be valid or null depending on parser
      expect(result === null || result instanceof Date).toBe(true);
    });

    it('should return null for malformed cron with invalid values', () => {
      // Suppress expected console.error from cron parser
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(getNextRunDate('60 * * * *')).toBeNull(); // 60 is invalid minute
      consoleSpy.mockRestore();
    });

    it('should handle cron with specific minutes', () => {
      // */15 * * * * = every 15 minutes
      const nextDate = getNextRunDate('*/15 * * * *');
      expect(nextDate).toBeInstanceOf(Date);
      expect([0, 15, 30, 45]).toContain(nextDate?.getMinutes());
    });

    it('should handle cron with range', () => {
      // 0 9-17 * * * = every hour from 9 AM to 5 PM
      const nextDate = getNextRunDate('0 9-17 * * *');
      expect(nextDate).toBeInstanceOf(Date);
      expect(nextDate?.getHours()).toBeGreaterThanOrEqual(9);
      expect(nextDate?.getHours()).toBeLessThanOrEqual(17);
    });

    it('should handle cron with list', () => {
      // 0 0 1,15 * * = 1st and 15th of every month
      const nextDate = getNextRunDate('0 0 1,15 * *');
      expect(nextDate).toBeInstanceOf(Date);
      expect([1, 15]).toContain(nextDate?.getDate());
    });

    it('should return future date even if current time matches', () => {
      // Ensure we get the next occurrence, not the current one
      jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));
      const nextDate = getNextRunDate('0 10 * * *');
      expect(nextDate).toBeInstanceOf(Date);
      // Should be the next day at 10:00 since current time is exactly 10:00
      expect(nextDate?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('formatNextRunDate', () => {
    // Tests date formatting for display in UI

    it('should return "No date" for null input', () => {
      expect(formatNextRunDate(null)).toBe('No date');
    });

    it('should format date with month, day, year, hour, and minute', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const formatted = formatNextRunDate(date);
      
      // Should contain month abbreviation
      expect(formatted).toMatch(/Jan/);
      // Should contain day
      expect(formatted).toMatch(/15/);
      // Should contain year
      expect(formatted).toMatch(/2024/);
    });

    it('should include time component', () => {
      const date = new Date('2024-06-20T09:45:00Z');
      const formatted = formatNextRunDate(date);
      
      // Should contain time
      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should handle different months correctly', () => {
      const dates = [
        { date: new Date('2024-02-15T12:00:00Z'), expected: 'Feb' },
        { date: new Date('2024-06-15T12:00:00Z'), expected: 'Jun' },
        { date: new Date('2024-12-15T12:00:00Z'), expected: 'Dec' },
      ];

      dates.forEach(({ date, expected }) => {
        expect(formatNextRunDate(date)).toContain(expected);
      });
    });

    it('should handle midnight correctly', () => {
      const date = new Date('2024-01-15T00:00:00Z');
      const formatted = formatNextRunDate(date);
      // Should show some time representation for midnight
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should handle end of day correctly', () => {
      const date = new Date('2024-01-15T23:59:00Z');
      const formatted = formatNextRunDate(date);
      expect(formatted).toBeDefined();
    });
  });
});
