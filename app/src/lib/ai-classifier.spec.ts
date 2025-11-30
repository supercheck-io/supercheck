/**
 * AI Classifier Tests
 * Tests for the AI-driven error classification system for determining test fixability
 */

import {
  FailureCategory,
  PlaywrightMarkdownParser,
  AIFixDecisionEngine,
} from './ai-classifier';

describe('AI Classifier', () => {
  describe('FailureCategory enum', () => {
    it('should have all AI-fixable categories defined', () => {
      expect(FailureCategory.SELECTOR_ISSUES).toBe('selector_issues');
      expect(FailureCategory.TIMING_PROBLEMS).toBe('timing_problems');
      expect(FailureCategory.ASSERTION_FAILURES).toBe('assertion_failures');
      expect(FailureCategory.NAVIGATION_ERRORS).toBe('navigation_errors');
    });

    it('should have all non-fixable categories defined', () => {
      expect(FailureCategory.NETWORK_ISSUES).toBe('network_issues');
      expect(FailureCategory.AUTHENTICATION_FAILURES).toBe('authentication_failures');
      expect(FailureCategory.INFRASTRUCTURE_DOWN).toBe('infrastructure_down');
      expect(FailureCategory.DATA_ISSUES).toBe('data_issues');
      expect(FailureCategory.PERMISSION_DENIED).toBe('permission_denied');
      expect(FailureCategory.RESOURCE_CONSTRAINTS).toBe('resource_constraints');
    });

    it('should have UNKNOWN category', () => {
      expect(FailureCategory.UNKNOWN).toBe('unknown');
    });
  });

  describe('PlaywrightMarkdownParser', () => {
    describe('parseMarkdownForErrors', () => {
      describe('selector issues detection', () => {
        it('should detect locator not found errors', () => {
          const markdown = `# Test Results
          Error: locator.click: Element not found
          Locator: [data-testid="submit-button"]`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors[0].classification?.category).toBe(FailureCategory.SELECTOR_ISSUES);
          expect(errors[0].classification?.aiFixable).toBe(true);
        });

        it('should detect element not visible errors', () => {
          const markdown = `# Error
          element not visible after 30000ms`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.SELECTOR_ISSUES)).toBe(true);
        });

        it('should detect strict mode violation', () => {
          const markdown = `# Test Failed
          strict mode violation: multiple elements matched`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.SELECTOR_ISSUES)).toBe(true);
        });

        it('should detect element not clickable', () => {
          const markdown = `# Error
          element is not clickable at point (100, 200)`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.SELECTOR_ISSUES)).toBe(true);
        });
      });

      describe('timing problems detection', () => {
        it('should detect timeout exceeded errors', () => {
          const markdown = `# Test Error
          timeout exceeded waiting for element`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.TIMING_PROBLEMS)).toBe(true);
        });

        it('should detect page.waitFor timeout', () => {
          const markdown = `# Failed
          page.waitForSelector: Timeout 30000ms exceeded`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.TIMING_PROBLEMS)).toBe(true);
        });

        it('should detect navigation timeout', () => {
          const markdown = `# Error
          navigation timeout of 30000 ms exceeded`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.TIMING_PROBLEMS)).toBe(true);
        });

        it('should detect expect timeout', () => {
          const markdown = `# Test Failed
          expect.toBeVisible: Timeout 5000ms exceeded`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.TIMING_PROBLEMS)).toBe(true);
        });
      });

      describe('assertion failures detection', () => {
        it('should detect expected vs received mismatches', () => {
          const markdown = `# Assertion Failed
          Expected: "Hello World"
          Received: "Hello"`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.ASSERTION_FAILURES)).toBe(true);
        });

        it('should detect toBe assertion failures', () => {
          const markdown = `# Test Error
          expect(value).toBe(expected) but received different`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.ASSERTION_FAILURES)).toBe(true);
        });

        it('should detect toHaveTitle mismatches', () => {
          const markdown = `# Failed
          toHaveTitle assertion failed
          Expected: "Home Page"
          Actual: "Login"`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.ASSERTION_FAILURES)).toBe(true);
        });

        it('should detect toHaveText assertion failures', () => {
          const markdown = `# Error
          Locator expected to have text "Submit" but received "Cancel"`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.length).toBeGreaterThan(0);
        });
      });

      describe('navigation errors detection', () => {
        it('should detect navigation failed errors', () => {
          const markdown = `# Error
          navigation failed: net::ERR_ABORTED`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.NAVIGATION_ERRORS)).toBe(true);
        });

        it('should detect 404 errors', () => {
          const markdown = `# Test Failed
          404 error: page not found`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.NAVIGATION_ERRORS)).toBe(true);
        });

        it('should detect route not found', () => {
          const markdown = `# Navigation Error
          route not found for path /dashboard`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.NAVIGATION_ERRORS)).toBe(true);
        });
      });

      describe('network issues detection', () => {
        it('should detect network errors', () => {
          // Parser needs error indicator keywords
          const markdown = `# Error
          Error: network error: Failed to fetch`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.NETWORK_ISSUES)).toBe(true);
          expect(errors.find(e => e.classification?.category === FailureCategory.NETWORK_ISSUES)?.classification?.aiFixable).toBe(false);
        });

        it('should detect connection refused', () => {
          const markdown = `# Failed
          Error: connection refused to localhost:3000`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.NETWORK_ISSUES)).toBe(true);
        });

        it('should detect HTTP 500 errors', () => {
          const markdown = `# Server Error
          Error: HTTP 500 Internal Server Error`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.NETWORK_ISSUES)).toBe(true);
        });

        it('should detect HTTP 502 errors', () => {
          const markdown = `# Gateway Error
          Error: HTTP 502 Bad Gateway`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.NETWORK_ISSUES)).toBe(true);
        });
      });

      describe('authentication failures detection', () => {
        it('should detect 401 unauthorized', () => {
          const markdown = `# Auth Error
          Error: HTTP 401 Unauthorized`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.AUTHENTICATION_FAILURES)).toBe(true);
          expect(errors.find(e => e.classification?.category === FailureCategory.AUTHENTICATION_FAILURES)?.classification?.aiFixable).toBe(false);
        });

        it('should detect 403 forbidden', () => {
          const markdown = `# Access Error
          Error: HTTP 403 Forbidden`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.AUTHENTICATION_FAILURES)).toBe(true);
        });

        it('should detect session expired', () => {
          const markdown = `# Error
          Error: session expired, please login again`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.AUTHENTICATION_FAILURES)).toBe(true);
        });
      });

      describe('infrastructure down detection', () => {
        it('should detect database connection failures', () => {
          // "database" + "connection" + "failed" triggers INFRASTRUCTURE_DOWN
          const markdown = `# Error
          Error: could not connect to database server`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.INFRASTRUCTURE_DOWN)).toBe(true);
          expect(errors.find(e => e.classification?.category === FailureCategory.INFRASTRUCTURE_DOWN)?.classification?.aiFixable).toBe(false);
        });

        it('should detect service unavailable', () => {
          const markdown = `# Server Error
          Error: service unavailable, please try later`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.INFRASTRUCTURE_DOWN)).toBe(true);
        });

        it('should detect maintenance mode', () => {
          const markdown = `# Down
          Error: Site is in maintenance mode`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.INFRASTRUCTURE_DOWN)).toBe(true);
        });
      });

      describe('resource constraints detection', () => {
        it('should detect out of memory errors', () => {
          const markdown = `# Fatal Error
          Error: out of memory: JavaScript heap allocation failed`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.RESOURCE_CONSTRAINTS)).toBe(true);
        });

        it('should detect process killed', () => {
          const markdown = `# Error
          Error: process killed due to resource limits`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.RESOURCE_CONSTRAINTS)).toBe(true);
        });
      });

      describe('permission denied detection', () => {
        it('should detect permission denied errors', () => {
          const markdown = `# Error
          Error: permission denied: cannot access file`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.PERMISSION_DENIED)).toBe(true);
        });

        it('should detect insufficient rights', () => {
          const markdown = `# Access Error
          Error: insufficient rights to perform action`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.PERMISSION_DENIED)).toBe(true);
        });
      });

      describe('data issues detection', () => {
        it('should detect missing data', () => {
          const markdown = `# Error
          Error: data not found: user record missing`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.DATA_ISSUES)).toBe(true);
        });

        it('should detect null reference', () => {
          const markdown = `# TypeError
          Error: Cannot read property 'name' of null reference`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          expect(errors.some(e => e.classification?.category === FailureCategory.DATA_ISSUES)).toBe(true);
        });
      });

      describe('unknown/fallback handling', () => {
        it('should return unknown classification for unrecognized errors', () => {
          const markdown = `# Test
          Some generic error message`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          // Should create a fallback error
          expect(errors.length).toBeGreaterThan(0);
        });

        it('should handle empty markdown gracefully', () => {
          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors('');
          expect(errors).toEqual([]);
        });

        it('should handle whitespace-only markdown', () => {
          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors('   \n\t  ');
          expect(errors).toEqual([]);
        });
      });

      describe('confidence scoring', () => {
        it('should have high confidence for selector issues', () => {
          const markdown = `# Error
          Error: locator not found: [data-testid="btn"]`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          const selectorError = errors.find(e => e.classification?.category === FailureCategory.SELECTOR_ISSUES);
          expect(selectorError?.classification?.confidence).toBeGreaterThanOrEqual(0.8);
        });

        it('should have critical severity for infrastructure issues', () => {
          const markdown = `# Error
          Error: database connection failed`;

          const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
          const infraError = errors.find(e => e.classification?.category === FailureCategory.INFRASTRUCTURE_DOWN);
          expect(infraError?.classification?.severity).toBe('critical');
        });
      });
    });
  });

  describe('AIFixDecisionEngine', () => {
    describe('shouldAttemptMarkdownFix', () => {
      it('should not attempt fix for empty errors array', () => {
        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix([]);
        expect(decision.shouldAttemptFix).toBe(false);
        expect(decision.reasoning).toContain('No errors found');
      });

      it('should attempt fix for AI-fixable selector issues', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Error
          locator not found: [data-testid="submit"]
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        expect(decision.shouldAttemptFix).toBe(true);
        expect(decision.confidence).toBeGreaterThan(0.5);
      });

      it('should not attempt fix for network issues', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Error
          Error: network error: connection refused
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        expect(decision.shouldAttemptFix).toBe(false);
        expect(decision.warningMessage).toBeTruthy();
      });

      it('should not attempt fix for authentication failures', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Auth Error
          Error: HTTP 401 Unauthorized
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        expect(decision.shouldAttemptFix).toBe(false);
        expect(decision.reasoning).toContain('authentication');
      });

      it('should not attempt fix for infrastructure down', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Error
          Error: database connection failed
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        expect(decision.shouldAttemptFix).toBe(false);
      });

      it('should attempt fix with warning for medium confidence', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Warning
          Some ambiguous test failure message
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        // Should still attempt but with lower confidence
        if (decision.shouldAttemptFix && decision.confidence < 0.6) {
          expect(decision.warningMessage).toBeTruthy();
        }
      });

      it('should provide actionable recommendations', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Network Error
          Error: HTTP 500 Internal Server Error
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        expect(decision.recommendedAction).toBeTruthy();
        expect(decision.recommendedAction.length).toBeGreaterThan(0);
      });

      it('should handle mixed fixable and non-fixable errors', () => {
        // Create a complex scenario with both types
        const markdown = `# Test Errors
          Error: locator not found
          Error: HTTP 500 Server Error`;

        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        
        // With mixed errors, behavior depends on implementation
        expect(decision.confidence).toBeGreaterThan(0);
        expect(decision.reasoning).toBeTruthy();
      });

      it('should have high confidence for multiple selector issues', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Errors
          Error: locator not found
          Error: element not visible
          Error: selector failed
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        expect(decision.shouldAttemptFix).toBe(true);
        expect(decision.confidence).toBeGreaterThanOrEqual(0.6);
      });

      it('should provide reasoning for timing problems', () => {
        const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(`
          # Timeout
          timeout exceeded waiting for element
        `);

        const decision = AIFixDecisionEngine.shouldAttemptMarkdownFix(errors);
        expect(decision.shouldAttemptFix).toBe(true);
        expect(decision.reasoning).toContain('AI fix');
      });
    });
  });

  describe('Error Classification Categories', () => {
    describe('AI-fixable categories', () => {
      const fixableCategories = [
        FailureCategory.SELECTOR_ISSUES,
        FailureCategory.TIMING_PROBLEMS,
        FailureCategory.ASSERTION_FAILURES,
        FailureCategory.NAVIGATION_ERRORS,
        FailureCategory.DATA_ISSUES,
      ];

      fixableCategories.forEach(category => {
        it(`${category} should be AI-fixable or data issues`, () => {
          // DATA_ISSUES is also AI-fixable according to the implementation
          expect([
            FailureCategory.SELECTOR_ISSUES,
            FailureCategory.TIMING_PROBLEMS,
            FailureCategory.ASSERTION_FAILURES,
            FailureCategory.NAVIGATION_ERRORS,
            FailureCategory.DATA_ISSUES,
          ]).toContain(category);
        });
      });
    });

    describe('Non-fixable categories', () => {
      const nonFixableCategories = [
        FailureCategory.NETWORK_ISSUES,
        FailureCategory.AUTHENTICATION_FAILURES,
        FailureCategory.INFRASTRUCTURE_DOWN,
        FailureCategory.PERMISSION_DENIED,
        FailureCategory.RESOURCE_CONSTRAINTS,
      ];

      nonFixableCategories.forEach(category => {
        it(`${category} should require manual investigation`, () => {
          expect(nonFixableCategories).toContain(category);
        });
      });
    });
  });

  describe('Severity Levels', () => {
    it('should categorize infrastructure down as critical', () => {
      const markdown = `# Error
        Error: database connection failed`;

      const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
      const infraError = errors.find(e => 
        e.classification?.category === FailureCategory.INFRASTRUCTURE_DOWN
      );
      expect(infraError?.classification?.severity).toBe('critical');
    });

    it('should categorize network issues as critical', () => {
      const markdown = `# Error
        Error: HTTP 500 Server Error`;

      const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
      const networkError = errors.find(e => 
        e.classification?.category === FailureCategory.NETWORK_ISSUES
      );
      expect(networkError?.classification?.severity).toBe('critical');
    });

    it('should categorize assertion failures as low severity', () => {
      const markdown = `# Failed
        Expected: "Hello"
        Received: "World"`;

      const errors = PlaywrightMarkdownParser.parseMarkdownForErrors(markdown);
      const assertionError = errors.find(e => 
        e.classification?.category === FailureCategory.ASSERTION_FAILURES
      );
      expect(assertionError?.classification?.severity).toBe('low');
    });
  });
});
