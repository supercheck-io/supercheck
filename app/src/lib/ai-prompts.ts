// AI prompt optimization for Playwright test fixing
interface PromptContext {
  failedScript: string;
  testType: string;
  markdownContent: string;
}

export class AIPromptBuilder {
  static buildMarkdownContextPrompt({
    failedScript,
    testType,
    markdownContent,
  }: PromptContext): string {
    const testTypeInstructions = this.getTestTypeInstructions(testType);
    const optimizedMarkdown = this.optimizeMarkdownContent(markdownContent);

    return `You are an expert Playwright test automation engineer specializing in ${testType} testing.

**TASK**: Fix the failing Playwright test based on the detailed error report below.

**TEST TYPE CONTEXT**:
${testTypeInstructions}

**CURRENT FAILING SCRIPT**:
\`\`\`javascript
${failedScript}
\`\`\`

**ERROR REPORT FROM PLAYWRIGHT**:
${optimizedMarkdown}

**FIXING GUIDELINES**:
1. **Preserve Intent**: Keep the original test logic and assertions intact
2. **Target Root Cause**: Fix only the specific issues mentioned in the error report
3. **Use Best Practices**: Apply Playwright best practices for reliability
4. **Minimal Changes**: Make the smallest changes necessary to fix the issue
5. **CRITICAL - Preserve ALL Comments**: You MUST keep every single comment (/* */, //, etc.) from the original script exactly as they are
6. **Maintain Structure**: Keep the existing test structure and variable names

**COMMON FIX PATTERNS**:
- Selector issues: Use more robust selectors (data-testid, role-based)
- Timing issues: Add proper waits (waitForSelector, waitForResponse)
- Element interaction: Ensure elements are visible/enabled before interaction
- Assertion problems: Use appropriate Playwright assertions with proper timeouts

**RESPONSE FORMAT**:
FIXED_SCRIPT:
\`\`\`javascript
[Your complete fixed test script here - clean code without explanation comments]
\`\`\`

EXPLANATION:
[Brief explanation of what was changed and why - focus on the specific fixes made]

CONFIDENCE:
[Rate your confidence in this fix on a scale of 0.1 to 1.0, where 1.0 means you're very confident this will resolve the issue]

**CRITICAL REQUIREMENTS**:
- Return only valid, executable Playwright test code
- ABSOLUTELY PRESERVE ALL COMMENTS: Every /* */, //, and /** */ comment must remain exactly as is
- Do NOT remove any existing comments from the original script
- Do NOT add EXPLANATION or CONFIDENCE comments in the code
- Do not include test runners, imports, or setup code unless they were part of the original script

**COMMENT PRESERVATION EXAMPLES**:
✅ CORRECT: Keep "// Send a GET request to a sample API endpoint" exactly as is
✅ CORRECT: Keep "/* Sample REST API Testing Script */" exactly as is
❌ WRONG: Removing or modifying any existing comments`;
  }

  // Build a basic prompt when detailed markdown reports aren't available
  static buildBasicFixPrompt({
    failedScript,
    testType,
    reason,
  }: {
    failedScript: string;
    testType: string;
    reason: string;
  }): string {
    const testTypeInstructions = this.getTestTypeInstructions(testType);

    return `You are an expert Playwright test automation engineer specializing in ${testType} testing.

**TASK**: Analyze and improve the failing Playwright test script below.

**CONTEXT**: ${reason}

**TEST TYPE**: ${testType}
${testTypeInstructions}

**CURRENT SCRIPT**:
\`\`\`javascript
${failedScript}
\`\`\`

**ANALYSIS GUIDELINES**:
Since detailed error reports aren't available, please:
1. **Review Common Issues**: Look for typical Playwright problems (selectors, timing, assertions)
2. **Apply Best Practices**: Improve the script with Playwright best practices
3. **Add Robustness**: Include proper waits and error handling
4. **Maintain Intent**: Keep the original test logic and purpose
5. **CRITICAL - Preserve ALL Comments**: You MUST keep every single comment (/* */, //, etc.) from the original script exactly as they are - do NOT remove any comments

**COMMON IMPROVEMENTS TO CONSIDER**:
- Replace brittle selectors with robust ones (data-testid, role-based)
- Add proper waits (waitForSelector, waitForLoadState)
- Use Playwright assertions instead of generic ones
- Add error handling for unreliable interactions
- Improve element interaction patterns

**RESPONSE FORMAT**:
FIXED_SCRIPT:
\`\`\`javascript
[Your improved test script here - clean code without explanation comments]
\`\`\`

EXPLANATION:
[Brief explanation of the improvements made to enhance test reliability]

CONFIDENCE:
[Rate your confidence in these improvements on a scale of 0.1 to 1.0, where 1.0 means you're very confident this will make the test more reliable]

**CRITICAL REQUIREMENTS**:
- Return only valid, executable Playwright test code
- ABSOLUTELY PRESERVE ALL COMMENTS: Every /* */, //, and /** */ comment must remain exactly as is
- Do NOT remove any existing comments from the original script
- Do NOT add EXPLANATION or CONFIDENCE comments in the code

**COMMENT PRESERVATION EXAMPLES**:
✅ CORRECT: Keep "// Send a GET request to a sample API endpoint" exactly as is
✅ CORRECT: Keep "/* Sample REST API Testing Script */" exactly as is
❌ WRONG: Removing or modifying any existing comments`;
  }

  private static getTestTypeInstructions(testType: string): string {
    switch (testType.toLowerCase()) {
      case "browser":
        return `This is a browser automation test. Focus on:
- Element selectors and interactions
- Page navigation and loading
- Visual elements and user interface testing
- Form submissions and user workflows`;

      case "api":
        return `This is an API test. Focus on:
- HTTP request/response handling
- Status codes and response validation
- Request headers and payloads
- Authentication and authorization`;

      case "database":
        return `This is a database test. Focus on:
- Database connections and queries
- Data validation and integrity
- Transaction handling
- Database state verification`;

      case "custom":
        return `This is a custom test scenario. Focus on:
- Understanding the specific test context
- Maintaining custom logic and patterns
- Preserving any specialized testing approaches`;

      default:
        return `Focus on understanding the test context and maintaining the original testing approach while fixing the specific issues identified.`;
    }
  }

  private static optimizeMarkdownContent(markdownContent: string): string {
    // Optimize markdown for token efficiency while preserving critical information
    const lines = markdownContent.split("\n");
    const importantSections = [];

    let currentSection = "";
    let isImportantSection = false;

    for (const line of lines) {
      // Identify important sections
      if (
        line.match(/^#+\s*(error|fail|instruction|detail|stack|exception)/i)
      ) {
        isImportantSection = true;
        if (currentSection) {
          importantSections.push(currentSection);
        }
        currentSection = line + "\n";
      } else if (line.match(/^#+\s/)) {
        isImportantSection = false;
        if (currentSection) {
          importantSections.push(currentSection);
        }
        currentSection = "";
      } else if (
        isImportantSection ||
        line.includes("Error:") ||
        line.includes("✗") ||
        line.includes("Failed:")
      ) {
        currentSection += line + "\n";
      }
    }

    if (currentSection) {
      importantSections.push(currentSection);
    }

    // Join important sections and truncate if too long
    let optimized = importantSections.join("\n").trim();

    // Truncate if content is too long (preserve first and last parts)
    if (optimized.length > 8000) {
      const firstPart = optimized.substring(0, 4000);
      const lastPart = optimized.substring(optimized.length - 4000);
      optimized =
        firstPart + "\n\n[... truncated for brevity ...]\n\n" + lastPart;
    }

    return optimized || markdownContent; // Fallback to original if optimization fails
  }

  // Generate contextual guidance for non-fixable issues
  static generateGuidanceMessage(): string {
    return `This test failure cannot be automatically fixed and requires manual investigation.`;
  }
}
