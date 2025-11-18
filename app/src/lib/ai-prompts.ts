// AI prompt optimization for test fixing and code generation
interface PromptContext {
  failedScript: string;
  testType: string;
  markdownContent: string;
}

interface K6PromptContext {
  failedScript: string;
  consoleLog?: string;
  summaryJSON?: string;
}

interface CreatePromptContext {
  currentScript?: string;
  testType: string;
  userRequest: string;
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

      case "performance":
        return `This is a K6 performance test. Focus on:
- HTTP request configuration and methods
- Performance thresholds and metrics
- Load testing scenarios and virtual users
- Response validation and checks`;

      default:
        return `Focus on understanding the test context and maintaining the original testing approach while fixing the specific issues identified.`;
    }
  }

  /**
   * Build prompt for K6 performance test fixing
   */
  static buildK6FixPrompt({
    failedScript,
    consoleLog = "",
    summaryJSON = "",
  }: K6PromptContext): string {
    const testTypeInstructions = this.getTestTypeInstructions("performance");

    return `You are an expert K6 performance testing engineer. Fix the failing K6 test based on the error information below.

**TASK**: Fix the failing K6 performance test script based on logs and error reports.

**TEST TYPE CONTEXT**:
${testTypeInstructions}

**CURRENT FAILING SCRIPT**:
\`\`\`javascript
${failedScript}
\`\`\`

${consoleLog ? `**CONSOLE LOG OUTPUT**:\n\`\`\`\n${consoleLog}\n\`\`\`` : ""}

${summaryJSON ? `**TEST SUMMARY (JSON)**:\n\`\`\`json\n${summaryJSON}\n\`\`\`` : ""}

**FIXING GUIDELINES**:
1. **Preserve Intent**: Keep the original test logic and purpose intact
2. **Target Root Cause**: Fix only the specific issues mentioned in the logs/summary
3. **Use Best Practices**: Apply K6 best practices for performance testing
4. **Minimal Changes**: Make the smallest changes necessary to fix the issue
5. **CRITICAL - Preserve ALL Comments**: You MUST keep every single comment (/* */, //, etc.) from the original script exactly as they are
6. **Maintain Structure**: Keep the existing test structure and variable names

**COMMON FIX PATTERNS**:
- Script errors: Fix JavaScript syntax, undefined variables, type errors
- HTTP request issues: Correct request methods, headers, payloads, URLs
- Threshold failures: Adjust unrealistic thresholds or optimize script performance
- Assertion problems: Fix incorrect checks or response validations

**RESPONSE FORMAT**:
FIXED_SCRIPT:
\`\`\`javascript
[Your complete fixed K6 test script here - clean code without explanation comments]
\`\`\`

EXPLANATION:
[Brief explanation of what was changed and why - focus on the specific fixes made]

CONFIDENCE:
[Rate your confidence in this fix on a scale of 0.1 to 1.0, where 1.0 means you're very confident this will resolve the issue]

**CRITICAL REQUIREMENTS**:
- Return only valid, executable K6 test code
- ABSOLUTELY PRESERVE ALL COMMENTS: Every /* */, //, and /** */ comment must remain exactly as is
- Do NOT remove any existing comments from the original script
- Do NOT add EXPLANATION or CONFIDENCE comments in the code
- Do not include imports or setup code unless they were part of the original script

**COMMENT PRESERVATION EXAMPLES**:
✅ CORRECT: Keep "// Test configuration for performance testing" exactly as is
✅ CORRECT: Keep "/* K6 Performance Test Script */" exactly as is
❌ WRONG: Removing or modifying any existing comments`;
  }

  /**
   * Build prompt for creating new test code based on user request
   */
  static buildCreatePrompt({
    currentScript = "",
    testType,
    userRequest,
  }: CreatePromptContext): string {
    const testTypeInstructions = this.getTestTypeInstructions(testType);

    const contextSection = currentScript
      ? `**CURRENT SCRIPT (FOR CONTEXT)**:
\`\`\`javascript
${currentScript}
\`\`\`

Use the current script as context, but create a NEW script based on the user's request. You may reference patterns, structure, or setup from the current script if relevant.`
      : `**NOTE**: No existing script provided. Create a complete, production-ready test script from scratch.`;

    return `You are an expert ${testType === "performance" ? "K6 performance" : "Playwright"} test automation engineer. Create a new test script based on the user's request.

**TEST TYPE**: ${testType}
${testTypeInstructions}

**USER REQUEST**:
${userRequest}

${contextSection}

**CREATION GUIDELINES**:
1. **Understand Intent**: Carefully analyze the user's request to understand what they want to test
2. **Best Practices**: Apply industry best practices for ${testType === "performance" ? "K6 performance testing" : "Playwright test automation"}
3. **Complete Solution**: Provide a complete, ready-to-run test script
4. **Clear Structure**: Use clear variable names, proper structure, and logical organization
5. **Add Comments**: Include helpful comments explaining key parts of the test
6. **Error Handling**: Include appropriate error handling and validations
7. **Production Ready**: Ensure the code is robust and production-ready

**RESPONSE FORMAT**:
GENERATED_SCRIPT:
\`\`\`javascript
[Your complete generated test script here - clean, well-commented code]
\`\`\`

EXPLANATION:
[Brief explanation of what the script does and how it fulfills the user's request]

**REQUIREMENTS**:
- Return only valid, executable ${testType === "performance" ? "K6" : "Playwright"} test code
- Include helpful comments to explain the test logic
- Do NOT add EXPLANATION comments in the code itself (explanation goes in the EXPLANATION section)
- Ensure the code is complete and ready to run
- Follow ${testType === "performance" ? "K6" : "Playwright"} best practices and conventions`;
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
