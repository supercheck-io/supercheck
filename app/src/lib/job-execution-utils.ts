import { db } from "@/utils/db";
import { tests, jobTests } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { resolveProjectVariables, extractVariableNames, generateVariableFunctions } from "./variable-resolver";
import type { VariableResolutionResult } from "./variable-resolver";

declare const Buffer: {
  from(data: string, encoding: string): { toString(encoding: string): string };
};

/**
 * Interface for processed test script
 */
export interface ProcessedTestScript {
  id: string;
  name: string;
  script: string;
  type?: string;
}

/**
 * Helper function to decode base64-encoded test scripts with robust error handling
 */
export async function decodeTestScript(base64Script: string): Promise<string> {
  // Input validation
  if (!base64Script || typeof base64Script !== 'string') {
    console.warn('Invalid script input for decoding, using as-is');
    return base64Script || '';
  }

  // Check if it's likely base64 (length should be multiple of 4, valid chars)
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  const isLikelyBase64 = base64Regex.test(base64Script) && base64Script.length % 4 === 0 && base64Script.length > 20;

  if (!isLikelyBase64) {
    // Script is probably already decoded
    return base64Script;
  }

  try {
    if (typeof window === "undefined") {
      // Server-side decoding
      const decoded = Buffer.from(base64Script, "base64").toString("utf-8");
      
      // Validate that the decoded content looks like JavaScript
      if (decoded.includes('import') || decoded.includes('test(') || decoded.includes('function')) {
        return decoded;
      } else {
        console.warn('Decoded content does not look like JavaScript, using original');
        return base64Script;
      }
    }
    // Client-side, return as-is (shouldn't happen in job execution)
    return base64Script;
  } catch (error) {
    console.error("Error decoding base64 script:", error);
    // Return original script as fallback
    return base64Script;
  }
}

/**
 * Applies variable resolution to test scripts
 * This function ensures consistent variable handling across all job execution types
 */
export async function applyVariablesToTestScripts(
  testScripts: ProcessedTestScript[],
  projectId: string,
  logPrefix: string
): Promise<{
  processedTestScripts: ProcessedTestScript[];
  variableResolution: VariableResolutionResult;
}> {
  // Resolve variables for the project
  console.log(`${logPrefix} Resolving project variables...`);
  const variableResolution = await resolveProjectVariables(projectId);
  
  if (variableResolution.errors && variableResolution.errors.length > 0) {
    console.warn(`${logPrefix} Variable resolution errors:`, variableResolution.errors);
    // Continue execution but log warnings
  }
  
  // Generate both getVariable and getSecret function implementations
  const variableFunctionCode = generateVariableFunctions(
    variableResolution.variables, 
    variableResolution.secrets
  );
  
  // Prepend the variable functions to each test script with logging
  const processedTestScripts = testScripts.map(testScript => {
    const usedVariables = extractVariableNames(testScript.script);
    console.log(`${logPrefix} Test ${testScript.name} uses ${usedVariables.length} variables: ${usedVariables.join(', ')}`);
    
    return {
      ...testScript,
      script: variableFunctionCode + '\n' + testScript.script
    };
  });

  return {
    processedTestScripts,
    variableResolution
  };
}

/**
 * Fetches and processes test scripts for a job with proper variable resolution
 * This function ensures consistent behavior across all job execution types
 */
export async function prepareJobTestScripts(
  jobId: string,
  projectId: string,
  runId: string,
  logPrefix?: string
): Promise<{
  testScripts: ProcessedTestScript[];
  variableResolution: VariableResolutionResult;
}> {
  const prefix = logPrefix || `[${jobId}/${runId}]`;
  
  // Fetch all tests associated with the job in the correct order
  const jobTestsList = await db
    .select({ testId: jobTests.testId, orderPosition: jobTests.orderPosition })
    .from(jobTests)
    .where(eq(jobTests.jobId, jobId))
    .orderBy(jobTests.orderPosition);

  if (jobTestsList.length === 0) {
    throw new Error("No tests found for this job");
  }

  // Fetch all test data from database
  const testIds = jobTestsList.map(jt => jt.testId);
  const testData = await db
    .select({
      id: tests.id,
      title: tests.title,
      script: tests.script,
      type: tests.type,
    })
    .from(tests)
    .where(inArray(tests.id, testIds));

  // Prepare test scripts with proper decoding
  const testScripts: ProcessedTestScript[] = [];
  
  for (const jobTest of jobTestsList) {
    const test = testData.find(t => t.id === jobTest.testId);
    if (!test) {
      console.error(`${prefix} Test not found for ID: ${jobTest.testId}`);
      continue;
    }

    if (!test.script) {
      console.error(`${prefix} No script found for test ${test.id}, skipping.`);
      continue;
    }

    // Decode the base64 script
    const decodedScript = await decodeTestScript(test.script);
    const testName = test.title || `Test ${test.id}`;
    
    testScripts.push({
      id: test.id,
      name: testName,
      script: decodedScript,
      type: test.type,
    });
  }

  if (testScripts.length === 0) {
    throw new Error("No valid test scripts found after processing");
  }

  console.log(`${prefix} Prepared ${testScripts.length} test scripts`);

  // Apply variable resolution using the unified function
  const { processedTestScripts, variableResolution } = await applyVariablesToTestScripts(
    testScripts,
    projectId,
    prefix
  );

  return {
    testScripts: processedTestScripts,
    variableResolution
  };
}
