
import { AIPromptBuilder } from './ai-prompts';
import { K6RunData } from './ai-prompts';

describe('AIPromptBuilder', () => {
  describe('buildK6AnalyzePrompt', () => {
    const mockBaselineRun: K6RunData = {
      runId: 'baseline-123',
      status: 'passed',
      startedAt: '2023-01-01T10:00:00Z',
      durationMs: 30000, // 30s
      requestRate: 100,
      metrics: {
        p95ResponseTimeMs: 200,
        p99ResponseTimeMs: 300,
        avgResponseTimeMs: 150,
        totalRequests: 3000,
        failedRequests: 0,
        vusMax: 10
      }
    };

    const mockJobName = 'Test Job';

    it('should generate prompt with correct duration', () => {
      const compareRun: K6RunData = {
        ...mockBaselineRun,
        runId: 'compare-123',
        durationMs: 30000 // Same duration
      };

      const prompt = AIPromptBuilder.buildK6AnalyzePrompt({
        baselineRun: mockBaselineRun,
        compareRun,
        jobName: mockJobName
      });

      expect(prompt).toContain('Job Name: Test Job');
      expect(prompt).toContain('Duration: 30s');
    });

    it('should calculate duration delta correctly', () => {
      const compareRun: K6RunData = {
        ...mockBaselineRun,
        runId: 'compare-123',
        durationMs: 45000 // +15s (50% increase)
      };

      const prompt = AIPromptBuilder.buildK6AnalyzePrompt({
        baselineRun: mockBaselineRun,
        compareRun,
        jobName: mockJobName
      });

      expect(prompt).toContain('Duration Change: +15s (50.0%)');
    });

    it('should include script modification caveat when duration change is significant', () => {
      const compareRun: K6RunData = {
        ...mockBaselineRun,
        runId: 'compare-123',
        durationMs: 60000 // +30s (100% increase)
      };

      const prompt = AIPromptBuilder.buildK6AnalyzePrompt({
        baselineRun: mockBaselineRun,
        compareRun,
        jobName: mockJobName
      });
      
      // Should mention significant duration changes in the instructions
      expect(prompt).toContain('OR significant duration changes (>10%)');
      expect(prompt).toContain('include the script modification caveat');
    });

    it('should handle null duration gracefully', () => {
      const compareRun: K6RunData = {
        ...mockBaselineRun,
        runId: 'compare-123',
        durationMs: null
      };

      const prompt = AIPromptBuilder.buildK6AnalyzePrompt({
        baselineRun: mockBaselineRun,
        compareRun,
        jobName: mockJobName
      });

      // Should handle N/A output
      expect(prompt).toMatch(/Duration: .*s/); // formatMetric handles nulls
    });

    it('should include HTML report snippets if provided', () => {
       const prompt = AIPromptBuilder.buildK6AnalyzePrompt({
        baselineRun: mockBaselineRun,
        compareRun: mockBaselineRun, 
        jobName: mockJobName,
        baselineReportHtml: '<html>baseline</html>',
        compareReportHtml: '<html>compare</html>'
      });

      expect(prompt).toContain('<HTML_REPORTS_CONTEXT>');
      expect(prompt).toContain('<html>baseline</html>');
      expect(prompt).toContain('<html>compare</html>');
    });
  });

  describe('buildMonitorAnalyzePrompt', () => {
    const mockMonitor = {
      id: 'monitor-123',
      name: 'Test Monitor',
      type: 'http_request',
      url: 'https://example.com/api/health',
      status: 'up' as const,
    };

    const mockStats24h = {
      avgResponseMs: 150,
      p95ResponseMs: 200,
      successRate: 99.5,
      checkCount: 100,
    };

    const mockStats7d = {
      avgResponseMs: 145,
      p95ResponseMs: 195,
      successRate: 99.2,
      checkCount: 700,
    };

    const mockRecentResults = [
      { status: 'up' as const, responseTimeMs: 120, checkedAt: '2023-01-01T10:00:00Z', location: 'us-east-1' },
      { status: 'up' as const, responseTimeMs: 135, checkedAt: '2023-01-01T09:55:00Z', location: 'us-east-1' },
    ];

    it('should generate prompt with monitor details', () => {
      const prompt = AIPromptBuilder.buildMonitorAnalyzePrompt({
        monitor: mockMonitor,
        stats24h: mockStats24h,
        stats7d: mockStats7d,
        recentResults: mockRecentResults,
      });

      expect(prompt).toContain('Name: Test Monitor');
      expect(prompt).toContain('Type: HTTP Request Monitor');
      expect(prompt).toContain('URL/Target: https://example.com/api/health');
      expect(prompt).toContain('Current Status: UP');
    });

    it('should include 24h and 7d statistics', () => {
      const prompt = AIPromptBuilder.buildMonitorAnalyzePrompt({
        monitor: mockMonitor,
        stats24h: mockStats24h,
        stats7d: mockStats7d,
        recentResults: mockRecentResults,
      });

      expect(prompt).toContain('Avg Response Time: 150.0ms');
      expect(prompt).toContain('P95 Response Time: 200.0ms');
      expect(prompt).toContain('Success Rate: 99.5%');
      expect(prompt).toContain('Check Count: 100');
    });

    it('should detect and flag high error rate', () => {
      const lowSuccessStats = { ...mockStats24h, successRate: 90 };
      const prompt = AIPromptBuilder.buildMonitorAnalyzePrompt({
        monitor: mockMonitor,
        stats24h: lowSuccessStats,
        stats7d: mockStats7d,
        recentResults: mockRecentResults,
      });

      expect(prompt).toContain('High Error Rate: YES');
    });

    it('should detect recent failures', () => {
      const resultsWithFailure = [
        { status: 'down' as const, responseTimeMs: null, errorMessage: 'Connection timeout', checkedAt: '2023-01-01T10:00:00Z' },
        ...mockRecentResults,
      ];
      const prompt = AIPromptBuilder.buildMonitorAnalyzePrompt({
        monitor: mockMonitor,
        stats24h: mockStats24h,
        stats7d: mockStats7d,
        recentResults: resultsWithFailure,
      });

      expect(prompt).toContain('Recent Failures: YES');
      expect(prompt).toContain('Connection timeout');
    });

    it('should include HTML report context for synthetic monitors', () => {
      const syntheticMonitor = { ...mockMonitor, type: 'synthetic_test' };
      const prompt = AIPromptBuilder.buildMonitorAnalyzePrompt({
        monitor: syntheticMonitor,
        stats24h: mockStats24h,
        stats7d: mockStats7d,
        recentResults: mockRecentResults,
        testReportHtml: '<html>report content</html>',
      });

      expect(prompt).toContain('<HTML_REPORT_CONTEXT>');
      expect(prompt).toContain('report content');
      expect(prompt).toContain('Playwright Synthetic Monitor');
    });

    it('should handle null metric values gracefully', () => {
      const nullStats = {
        avgResponseMs: null,
        p95ResponseMs: null,
        successRate: null,
        checkCount: 0,
      };
      const prompt = AIPromptBuilder.buildMonitorAnalyzePrompt({
        monitor: mockMonitor,
        stats24h: nullStats,
        stats7d: nullStats,
        recentResults: [],
      });

      expect(prompt).toContain('Avg Response Time: N/A');
      expect(prompt).toContain('Success Rate: N/A');
    });
  });

  describe('buildJobAnalyzePrompt', () => {
    const mockRun = {
      id: 'run-123',
      status: 'passed',
      durationMs: 30000,
      startedAt: '2023-01-01T10:00:00Z',
      completedAt: '2023-01-01T10:00:30Z',
    };

    const mockJob = {
      id: 'job-123',
      name: 'E2E Test Suite',
      type: 'playwright',
    };

    it('should generate prompt with run details', () => {
      const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
        run: mockRun,
        job: mockJob,
      });

      expect(prompt).toContain('Run ID: run-123');
      expect(prompt).toContain('Job Name: E2E Test Suite');
      expect(prompt).toContain('Status: PASSED');
    });

    it('should include error details for failed runs', () => {
      const failedRun = {
        ...mockRun,
        status: 'failed',
        errorDetails: 'Element not found: #submit-button',
      };
      const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
        run: failedRun,
        job: mockJob,
      });

      expect(prompt).toContain('<ERROR_DETAILS>');
      expect(prompt).toContain('Element not found');
    });

    it('should use slice for logs to get last 3000 chars', () => {
      // Create a string longer than 3000 chars
      const longLogs = 'A'.repeat(5000) + 'END_MARKER';
      const runWithLogs = {
        ...mockRun,
        logs: longLogs,
      };
      const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
        run: runWithLogs,
        job: mockJob,
      });

      // The END_MARKER should be present since we're taking the last 3000 chars
      expect(prompt).toContain('END_MARKER');
      expect(prompt).toContain('<EXECUTION_LOGS>');
    });

    it('should include HTML report context when provided', () => {
      const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
        run: mockRun,
        job: mockJob,
        testReportHtml: '<html>test report</html>',
      });

      expect(prompt).toContain('<HTML_REPORT_CONTEXT>');
      expect(prompt).toContain('test report');
    });

    it('should format job type correctly', () => {
      const k6Job = { ...mockJob, type: 'k6' };
      const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
        run: mockRun,
        job: k6Job,
      });

      expect(prompt).toContain('K6 Performance Test');
    });

    it('should handle null job gracefully', () => {
      const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
        run: mockRun,
        job: null,
      });

      expect(prompt).toContain('Job Name: Unknown');
    });

    it('should format duration correctly', () => {
      const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
        run: mockRun,
        job: mockJob,
      });

      // 30000ms = 30s
      expect(prompt).toContain('30s');
    });
  });
});
