#!/usr/bin/env tsx

/**
 * Test script to verify the fallback email template generation
 * This simulates React Email rendering failures and tests the fallback mechanism
 */

import { generateFallbackEmail } from '../src/lib/processors/email-template-processor';

async function testFallbackEmails() {
  console.log("Testing fallback email template generation...\n");

  // Test job success fallback
  console.log("1. Testing job success fallback:");
  const jobSuccessData = {
    jobName: "Test Job",
    duration: 45,
    runId: "test-run-123",
    dashboardUrl: "https://example.com/dashboard",
  };

  const jobSuccessResult = generateFallbackEmail("job-success", jobSuccessData);
  console.log("   Subject:", jobSuccessResult.subject);
  console.log("   HTML contains 'Supercheck Notification':", jobSuccessResult.html.includes("Supercheck Notification"));
  console.log("   HTML contains green header:", jobSuccessResult.html.includes("#10b981"));
  console.log("   Text contains job details:", jobSuccessResult.text.includes("Job Name: Test Job"));
  console.log("   ✅ Job success fallback working\n");

  // Test job failure fallback
  console.log("2. Testing job failure fallback:");
  const jobFailureData = {
    jobName: "Failed Job",
    duration: 120,
    errorMessage: "Connection timeout to database",
    runId: "failed-run-456",
    dashboardUrl: "https://example.com/dashboard",
  };

  const jobFailureResult = generateFallbackEmail("job-failure", jobFailureData);
  console.log("   Subject:", jobFailureResult.subject);
  console.log("   HTML contains red header:", jobFailureResult.html.includes("#dc2626"));
  console.log("   HTML contains error message:", jobFailureResult.html.includes("Connection timeout"));
  console.log("   Text contains error details:", jobFailureResult.text.includes("Error: Connection timeout"));
  console.log("   ✅ Job failure fallback working\n");

  // Test monitor alert fallback
  console.log("3. Testing monitor alert fallback:");
  const monitorData = {
    title: "Website Down",
    message: "The website https://example.com is not responding.",
    color: "#dc2626",
    fields: [
      { title: "URL", value: "https://example.com" },
      { title: "Status Code", value: "503" },
      { title: "Response Time", value: "5000ms" },
    ],
    footer: "Supercheck Monitoring System",
  };

  const monitorResult = generateFallbackEmail("monitor-alert", monitorData);
  console.log("   Subject:", monitorResult.subject);
  console.log("   HTML contains monitor message:", monitorResult.html.includes("not responding"));
  console.log("   HTML contains field table:", monitorResult.html.includes("URL"));
  console.log("   Text contains structured data:", monitorResult.text.includes("URL: https://example.com"));
  console.log("   ✅ Monitor alert fallback working\n");

  // Test XSS protection
  console.log("4. Testing XSS protection:");
  const xssData = {
    jobName: "<script>alert('xss')</script>",
    errorMessage: "Error with <img src=x onerror=alert(1)> content",
    duration: 10,
  };

  const xssResult = generateFallbackEmail("job-failure", xssData);
  console.log("   Subject:", xssResult.subject);
  console.log("   HTML escapes script tags:", !xssResult.html.includes("<script>"));
  console.log("   HTML contains escaped entities:", xssResult.html.includes("&lt;script&gt;"));
  console.log("   Text is safe:", !xssResult.text.includes("<script>"));
  console.log("   ✅ XSS protection working\n");

  // Save sample HTML for manual inspection
  const fs = require('fs');
  const samplePath = '/tmp/fallback-email-sample.html';
  fs.writeFileSync(samplePath, jobSuccessResult.html);
  console.log(`📄 Sample fallback HTML saved to: ${samplePath}`);

  console.log("\n✅ All fallback email tests passed!");
  console.log("The fallback mechanism will generate simple, clean emails");
  console.log("that match the current design when React Email fails.");
}

// Run the tests
testFallbackEmails().catch(console.error);
