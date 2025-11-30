import { formatDistanceToNow, formatDurationMinutes } from './date-utils';

describe('DateUtils', () => {
  describe('formatDistanceToNow', () => {
    // Tests relative time formatting for UI display

    beforeEach(() => {
      // Mock Date.now() for consistent tests
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return "just now" for times less than 30 seconds ago', () => {
      // Recent timestamps should show "just now" for better UX
      const date = new Date('2024-01-15T11:59:45Z'); // 15 seconds ago
      expect(formatDistanceToNow(date)).toBe('just now');
    });

    it('should return seconds for times between 30 seconds and 1 minute ago', () => {
      const date = new Date('2024-01-15T11:59:15Z'); // 45 seconds ago
      expect(formatDistanceToNow(date)).toBe('45 seconds ago');
    });

    it('should return singular "minute" for exactly 1 minute ago', () => {
      const date = new Date('2024-01-15T11:59:00Z'); // 1 minute ago
      expect(formatDistanceToNow(date)).toBe('1 minute ago');
    });

    it('should return plural "minutes" for multiple minutes ago', () => {
      const date = new Date('2024-01-15T11:55:00Z'); // 5 minutes ago
      expect(formatDistanceToNow(date)).toBe('5 minutes ago');
    });

    it('should return singular "hour" for exactly 1 hour ago', () => {
      const date = new Date('2024-01-15T11:00:00Z'); // 1 hour ago
      expect(formatDistanceToNow(date)).toBe('1 hour ago');
    });

    it('should return plural "hours" for multiple hours ago', () => {
      const date = new Date('2024-01-15T09:00:00Z'); // 3 hours ago
      expect(formatDistanceToNow(date)).toBe('3 hours ago');
    });

    it('should return singular "day" for exactly 1 day ago', () => {
      const date = new Date('2024-01-14T12:00:00Z'); // 1 day ago
      expect(formatDistanceToNow(date)).toBe('1 day ago');
    });

    it('should return plural "days" for multiple days ago', () => {
      const date = new Date('2024-01-12T12:00:00Z'); // 3 days ago
      expect(formatDistanceToNow(date)).toBe('3 days ago');
    });

    it('should return singular "week" for exactly 1 week ago', () => {
      const date = new Date('2024-01-08T12:00:00Z'); // 1 week ago
      expect(formatDistanceToNow(date)).toBe('1 week ago');
    });

    it('should return plural "weeks" for multiple weeks ago', () => {
      const date = new Date('2024-01-01T12:00:00Z'); // 2 weeks ago
      expect(formatDistanceToNow(date)).toBe('2 weeks ago');
    });

    it('should return singular "month" for approximately 1 month ago', () => {
      const date = new Date('2023-12-15T12:00:00Z'); // ~1 month ago
      expect(formatDistanceToNow(date)).toBe('1 month ago');
    });

    it('should return plural "months" for multiple months ago', () => {
      const date = new Date('2023-10-15T12:00:00Z'); // ~3 months ago
      expect(formatDistanceToNow(date)).toBe('3 months ago');
    });

    it('should return singular "year" for exactly 1 year ago', () => {
      const date = new Date('2023-01-15T12:00:00Z'); // 1 year ago
      expect(formatDistanceToNow(date)).toBe('1 year ago');
    });

    it('should return plural "years" for multiple years ago', () => {
      const date = new Date('2022-01-15T12:00:00Z'); // 2 years ago
      expect(formatDistanceToNow(date)).toBe('2 years ago');
    });

    it('should accept ISO string dates', () => {
      // API often returns ISO strings
      expect(formatDistanceToNow('2024-01-15T11:55:00Z')).toBe('5 minutes ago');
    });

    it('should accept Date objects', () => {
      const date = new Date('2024-01-15T11:55:00Z');
      expect(formatDistanceToNow(date)).toBe('5 minutes ago');
    });

    it('should return "Invalid date" for invalid date strings', () => {
      // Guard against invalid inputs
      expect(formatDistanceToNow('not-a-date')).toBe('Invalid date');
    });

    it('should handle edge case at exactly 60 seconds', () => {
      const date = new Date('2024-01-15T11:59:00Z'); // exactly 60 seconds ago
      expect(formatDistanceToNow(date)).toBe('1 minute ago');
    });

    it('should handle edge case at exactly 60 minutes', () => {
      const date = new Date('2024-01-15T11:00:00Z'); // exactly 60 minutes ago
      expect(formatDistanceToNow(date)).toBe('1 hour ago');
    });
  });

  describe('formatDurationMinutes', () => {
    // Tests duration formatting for monitor intervals and test durations

    describe('minutes only', () => {
      it('should format 1 minute as "1m"', () => {
        expect(formatDurationMinutes(1)).toBe('1m');
      });

      it('should format 30 minutes as "30m"', () => {
        expect(formatDurationMinutes(30)).toBe('30m');
      });

      it('should format 59 minutes as "59m"', () => {
        expect(formatDurationMinutes(59)).toBe('59m');
      });
    });

    describe('hours only', () => {
      it('should format 60 minutes as "1h"', () => {
        // Exactly 1 hour should not show minutes
        expect(formatDurationMinutes(60)).toBe('1h');
      });

      it('should format 120 minutes as "2h"', () => {
        expect(formatDurationMinutes(120)).toBe('2h');
      });

      it('should format 720 minutes as "12h"', () => {
        expect(formatDurationMinutes(720)).toBe('12h');
      });
    });

    describe('hours and minutes', () => {
      it('should format 90 minutes as "1h 30m"', () => {
        expect(formatDurationMinutes(90)).toBe('1h 30m');
      });

      it('should format 61 minutes as "1h 1m"', () => {
        expect(formatDurationMinutes(61)).toBe('1h 1m');
      });

      it('should format 150 minutes as "2h 30m"', () => {
        expect(formatDurationMinutes(150)).toBe('2h 30m');
      });
    });

    describe('days only', () => {
      it('should format 1440 minutes as "1d"', () => {
        // Exactly 24 hours = 1 day
        expect(formatDurationMinutes(1440)).toBe('1d');
      });

      it('should format 2880 minutes as "2d"', () => {
        // 48 hours = 2 days
        expect(formatDurationMinutes(2880)).toBe('2d');
      });
    });

    describe('days and hours', () => {
      it('should format 1500 minutes as "1d 1h"', () => {
        // 25 hours
        expect(formatDurationMinutes(1500)).toBe('1d 1h');
      });

      it('should format 1800 minutes as "1d 6h"', () => {
        // 30 hours
        expect(formatDurationMinutes(1800)).toBe('1d 6h');
      });
    });

    describe('days, hours, and minutes', () => {
      it('should format 1501 minutes as "1d 1h 1m"', () => {
        // 25 hours and 1 minute
        expect(formatDurationMinutes(1501)).toBe('1d 1h 1m');
      });

      it('should format 1530 minutes as "1d 1h 30m"', () => {
        // 25.5 hours
        expect(formatDurationMinutes(1530)).toBe('1d 1h 30m');
      });

      it('should format 2970 minutes as "2d 1h 30m"', () => {
        // 49.5 hours
        expect(formatDurationMinutes(2970)).toBe('2d 1h 30m');
      });
    });

    describe('edge cases', () => {
      it('should format 0 minutes as "0m"', () => {
        expect(formatDurationMinutes(0)).toBe('0m');
      });

      it('should handle large values', () => {
        // 7 days = 10080 minutes
        expect(formatDurationMinutes(10080)).toBe('7d');
      });

      it('should format 1441 minutes correctly', () => {
        // 1 day + 1 minute
        expect(formatDurationMinutes(1441)).toBe('1d 1m');
      });
    });
  });
});
