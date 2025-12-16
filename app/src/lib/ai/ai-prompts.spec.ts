
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
});
