import { db } from "@/utils/db";
import { tests, jobTests } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { resolveProjectVariables, extractVariableNames } from "./variable-resolver";
import type { VariableResolutionResult } from "./variable-resolver";
import { decodeStoredTestScript } from "./test-script";

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
  return decodeStoredTestScript(base64Script);
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
  
  // Keep scripts unchanged; variable helpers are injected securely at worker runtime
  const processedTestScripts = testScripts.map(testScript => {
    const usedVariables = extractVariableNames(testScript.script);
    console.log(`${logPrefix} Test ${testScript.name} uses ${usedVariables.length} variables: ${usedVariables.join(', ')}`);
    
    return {
      ...testScript,
      script: testScript.script
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
    .where(
      and(
        inArray(tests.id, testIds),
        eq(tests.projectId, projectId),
      ),
    );

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
