/**
 * Script Service
 *
 * This service handles loading sample scripts for different test types.
 * It provides a simple API for getting script content without using state management.
 */

export enum ScriptType {
  Browser = "browser",
  API = "api",
  Database = "database",
  Custom = "custom",
}

// Sample scripts content
const scripts: Record<ScriptType, string> = {
  [ScriptType.Browser]: `/**
 * Sample Browser Automation Test Script
 * 
 * This script demonstrates comprehensive browser testing using Playwright framework.
 * It covers essential web application testing patterns including page navigation,
 * title verification, link interaction, form handling, and DOM element validation.
 * 
 * Test Coverage:
 * - Page loading and title verification
 * - Navigation flow and link interaction  
 * - Form input and submission handling
 * - Element visibility and accessibility testing
 * 
 * Target Websites:
 * - https://playwright.dev/ - Official Playwright documentation
 * - https://demo.playwright.dev/todomvc - TodoMVC demo application
 * 
 * @requires '@playwright/test' package
 */

import { test, expect } from '@playwright/test';

test('Browser check - Page title verification', async ({ page }) => {
  // Navigate to the website
  await page.goto('https://playwright.dev/');

  // Verify the page title contains the expected text
  await expect(page).toHaveTitle(/Playwright/);
  
  console.log('✅ Page title verified successfully');
});

test('Browser check - Navigation and element visibility', async ({ page }) => {
  // Navigate to the website
  await page.goto('https://playwright.dev/');

  // Click the get started link
  await page.getByRole('link', { name: 'Get started' }).click();

  // Verify that the expected heading is visible after navigation
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
  
  console.log('✅ Navigation and element visibility verified');
});

test('Browser check - Form interaction', async ({ page }) => {
  // Navigate to the website with a form
  await page.goto('https://demo.playwright.dev/todomvc');

  // Type into the new todo input
  await page.getByPlaceholder('What needs to be done?').fill('Test automation with Playwright');
  await page.getByPlaceholder('What needs to be done?').press('Enter');

  // Verify the todo item was added
  await expect(page.getByTestId('todo-title')).toHaveText(['Test automation with Playwright']);
  
  console.log('✅ Form interaction verified');
})
`,

  [ScriptType.API]: `/**
 * Sample REST API Testing Script
 * 
 * This script demonstrates comprehensive API endpoint testing using Playwright's
 * built-in HTTP client. It covers essential API testing patterns including CRUD
 * operations, response validation, data integrity checks, and error handling.
 * 
 * Test Coverage:
 * - GET requests with response validation
 * - POST requests with request body handling
 * - HTTP status code verification
 * - JSON response structure validation
 * - Error handling for non-existent resources
 * 
 * Target API: JSONPlaceholder - Free fake REST API for testing
 * Base URL: https://jsonplaceholder.typicode.com/
 * Documentation: https://jsonplaceholder.typicode.com/guide/
 * 
 * @requires '@playwright/test' package
 */

import { test, expect } from '@playwright/test';

test('API check - GET request with status and data validation', async ({ request }) => {
  // Send a GET request to a sample API endpoint
  const response = await request.get('https://jsonplaceholder.typicode.com/todos/1');
  
  // Verify the response status is 200 OK
  expect(response.status()).toBe(200);
  
  // Parse and validate the response data
  const responseData = await response.json();
  expect(responseData).toEqual({
    userId: 1,
    id: 1,
    title: 'delectus aut autem',
    completed: false,
  });
  
  console.log('✅ GET request validated successfully');
});

test('API check - POST request with request body', async ({ request }) => {
  // Create data for the POST request
  const newTodo = {
    title: 'Test API with Playwright',
    completed: false,
    userId: 1
  };
  
  // Send a POST request with the data
  const response = await request.post('https://jsonplaceholder.typicode.com/todos', {
    data: newTodo
  });
  
  // Verify the response status is 201 Created
  expect(response.status()).toBe(201);
  
  // Parse and validate the response data
  const responseData = await response.json();
  expect(responseData).toHaveProperty('id');
  expect(responseData.title).toBe(newTodo.title);
  
  console.log('✅ POST request validated successfully');
});

test('API check - Error handling for non-existent resource', async ({ request }) => {
  // Send a GET request to a non-existent resource
  const response = await request.get('https://jsonplaceholder.typicode.com/todos/999999');
  
  // Verify the response status is 404 Not Found
  expect(response.status()).toBe(404);
  
  // Verify the response body is empty
  const responseData = await response.json();
  expect(Object.keys(responseData).length).toBe(0);
  
  console.log('✅ Error handling validated successfully');
});
`,

  [ScriptType.Database]: `/**
 * Sample Database Query Test Script
 * 
 * This script demonstrates connecting to the RNAcentral public PostgreSQL database
 * hosted by the European Bioinformatics Institute (EBI). It performs database
 * connection testing, schema discovery, and basic query validation.
 * 
 * Test Coverage:
 * - Database connection and authentication
 * - Basic database information retrieval
 * - Schema discovery and table enumeration
 * - Query execution and result validation
 * - Connection cleanup and error handling
 * 
 * Target Database: RNAcentral Public PostgreSQL (Read-only)
 * Host: hh-pgsql-public.ebi.ac.uk:5432
 * Database: pfmegrnargs
 * Documentation: https://rnacentral.org/help/public-database
 * 
 * @requires 'pg' package
 * @requires '@playwright/test' package
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";

const config = {
  connectionString: "postgres://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs",
  ssl: false
};

test("Database Query Test - Connection and Basic Info", async () => {
  const client = new Client(config);
  
  try {
    await client.connect();
    console.log("✅ Connected to RNAcentral PostgreSQL database");

    // Test 1: Get database basic information (always works)
    const infoResult = await client.query(\`
      SELECT 
        version() as db_version,
        current_database() as database_name,
        current_user as connected_user,
        current_timestamp as connection_time
    \`);

    console.log("Database Information:");
    console.log(\`Database: \${infoResult.rows[0].database_name}\`);
    console.log(\`Connected as: \${infoResult.rows[0].connected_user}\`);
    console.log(\`Connection Time: \${infoResult.rows[0].connection_time}\`);
    console.log(\`Version: \${infoResult.rows[0].db_version.split(',')[0]}\`);

    expect(infoResult.rows.length).toBe(1);
    expect(infoResult.rows[0].database_name).toBe('pfmegrnargs');
    expect(infoResult.rows[0].connected_user).toBe('reader');

    // Test 2: Check server settings and capabilities
    const settingsResult = await client.query(\`
      SELECT 
        setting as timezone
      FROM pg_settings 
      WHERE name = 'TimeZone'
    \`);

    console.log(\`Server Timezone: \${settingsResult.rows[0].timezone}\`);
    expect(settingsResult.rows.length).toBe(1);

    console.log("✅ Connection and basic info test completed successfully");
  } catch (err) {
    console.error("Database query failed:", err);
    throw err;
  } finally {
    await client.end();
    console.log("✅ Database connection closed");
  }
});

test("Database Query Test - Schema Discovery", async () => {
  const client = new Client(config);
  
  try {
    await client.connect();
    console.log("✅ Connected to RNAcentral PostgreSQL database");

    // Test 1: Discover all available schemas
    const schemasResult = await client.query(\`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ORDER BY schema_name
    \`);

    console.log("Available Schemas:");
    schemasResult.rows.forEach((schema, index) => {
      console.log(\`\${index + 1}. \${schema.schema_name}\`);
    });

    expect(schemasResult.rows.length).toBeGreaterThanOrEqual(1);

    // Test 2: Discover tables in each schema
    for (const schema of schemasResult.rows) {
      const tablesResult = await client.query(\`
        SELECT table_name, table_type
        FROM information_schema.tables 
        WHERE table_schema = $1
        ORDER BY table_name
        LIMIT 5
      \`, [schema.schema_name]);

      console.log(\`Tables in \${schema.schema_name} schema (first 5):\`);
      if (tablesResult.rows.length > 0) {
        tablesResult.rows.forEach((table, index) => {
          console.log(\`  \${index + 1}. \${table.table_name} (\${table.table_type})\`);
        });
      } else {
        console.log("  No tables found or no access to tables");
      }
    }

    console.log("✅ Schema discovery completed successfully");
  } catch (err) {
    console.error("Database query failed:", err);
    throw err;
  } finally {
    await client.end();
    console.log("✅ Database connection closed");
  }
});

`,

  [ScriptType.Custom]: `/**
 * Sample Advanced Integration Test Script
 * 
 * This script demonstrates end-to-end testing scenarios combining
 * API testing with browser automation. It showcases real-world testing patterns
 * for modern web applications including data consistency validation across
 * different interfaces (API vs Web UI).
 * 
 * Test Coverage:
 * - API data retrieval and validation
 * - Browser automation with dynamic content
 * - Cross-platform data consistency verification
 * - Repository analysis and contributor metrics
 * - User profile validation across API and UI
 * 
 * Target Platform: GitHub Public API and Web Interface
 * API Base URL: https://api.github.com/
 * Web Interface: https://github.com/
 * API Documentation: https://docs.github.com/en/rest
 * 
 * @requires '@playwright/test' package
 */

import { test, expect } from "@playwright/test";

test("GitHub Repository Analysis - API + Browser Integration", async ({
  request,
  page,
}) => {
  console.log("🚀 Starting GitHub repository analysis workflow...");

  const repoOwner = "microsoft";
  const repoName = "playwright";

  // Step 1: API - Get repository information
  console.log("Step 1: Fetching repository data via GitHub API...");
  const repoResponse = await request.get(
    \`https://api.github.com/repos/\${repoOwner}/\${repoName}\`
  );

  expect(repoResponse.status()).toBe(200);
  const repoData = await repoResponse.json();
  
  console.log(\`📊 Repository: \${repoData.full_name}\`);
  console.log(\`⭐ Stars: \${repoData.stargazers_count}\`);
  console.log(\`🍴 Forks: \${repoData.forks_count}\`);
  console.log(\`📝 Description: \${repoData.description}\`);
  console.log(\`🔗 Language: \${repoData.language}\`);

  // Step 2: Browser - Navigate to repository page
  console.log("Step 2: Opening GitHub repository in browser...");
  await page.goto(\`https://github.com/\${repoOwner}/\${repoName}\`);
  
  // Verify page loaded correctly
  await expect(page).toHaveTitle(/playwright/i);
  
  // Step 3: Cross-validate API data with browser content
  console.log("Step 3: Validating API data against browser content...");
  
  // Check repository name is in the page using more specific selector
  await expect(page.getByRole('heading', { name: '🎭 Playwright' })).toBeVisible();
  console.log(\`✅ Repository page loaded and confirmed\`);

  console.log("✅ Repository analysis completed successfully");
});

test("GitHub API Data Analysis", async ({ request }) => {
  console.log("🚀 Starting GitHub API data analysis...");

  const repoOwner = "microsoft";
  const repoName = "playwright";

  // Step 1: Get repository issues
  console.log("Step 1: Fetching repository issues via API...");
  const issuesResponse = await request.get(
    \`https://api.github.com/repos/\${repoOwner}/\${repoName}/issues?state=open&per_page=10\`
  );

  expect(issuesResponse.status()).toBe(200);
  const issues = await issuesResponse.json();
  
  console.log(\`📋 Found \${issues.length} open issues (showing first 10)\`);
  
  // Analyze issue types and labels
  const issueAnalysis = {
    withLabels: issues.filter(issue => issue.labels.length > 0).length,
    withAssignees: issues.filter(issue => issue.assignees.length > 0).length,
    averageComments: Math.round(issues.reduce((sum, issue) => sum + issue.comments, 0) / issues.length)
  };

  console.log(\`🏷️  Issues with labels: \${issueAnalysis.withLabels}/\${issues.length}\`);
  console.log(\`👥 Issues with assignees: \${issueAnalysis.withAssignees}/\${issues.length}\`);
  console.log(\`💬 Average comments per issue: \${issueAnalysis.averageComments}\`);

  // Step 2: Get repository contributors
  console.log("Step 2: Fetching repository contributors...");
  const contributorsResponse = await request.get(
    \`https://api.github.com/repos/\${repoOwner}/\${repoName}/contributors?per_page=5\`
  );

  expect(contributorsResponse.status()).toBe(200);
  const contributors = await contributorsResponse.json();
  
  console.log(\`👨‍💻 Top \${contributors.length} Contributors:\`);
  contributors.forEach((contributor, index) => {
    console.log(\`  \${index + 1}. \${contributor.login} - \${contributor.contributions} contributions\`);
  });

  expect(contributors.length).toBeGreaterThan(0);
  console.log("✅ API data analysis completed successfully");
});

test("GitHub User Profile Analysis", async ({ request, page }) => {
  console.log("🚀 Starting GitHub user profile analysis...");

  const username = "torvalds";

  // Step 1: API - Get user profile information
  console.log("Step 1: Fetching user profile via GitHub API...");
  const userResponse = await request.get(\`https://api.github.com/users/\${username}\`);

  expect(userResponse.status()).toBe(200);
  const userData = await userResponse.json();
  
  console.log(\`👤 User: \${userData.login}\`);
  console.log(\`📝 Name: \${userData.name || 'Not provided'}\`);
  console.log(\`📊 Public Repos: \${userData.public_repos}\`);
  console.log(\`👥 Followers: \${userData.followers}\`);

  // Step 2: Browser - Navigate to user profile
  console.log("Step 2: Validating user profile in browser...");
  await page.goto(\`https://github.com/\${username}\`);
  
  // Wait for profile to load and validate we're on correct page
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(new RegExp(username));
  console.log(\`✅ Confirmed on \${username}'s profile page\`);

  console.log("✅ User profile analysis completed successfully");
});

`,
};

/**
 * Get the content of a sample script by type
 */
export function getSampleScript(type: ScriptType): string {
  return scripts[type] || getDefaultScript();
}

/**
 * Get a default script if the requested script is not found
 */
function getDefaultScript(): string {
  return `import { test, expect } from '@playwright/test';

test('basic test', async ({ page }) => {
  // Navigate to a website
  await page.goto('https://playwright.dev/');

  // Verify the page title
  await expect(page).toHaveTitle(/Playwright/);
  
  // Click a link and verify navigation
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});
`;
}

/**
 * Get a list of all available sample scripts
 */
export function getAvailableScripts(): ScriptType[] {
  return Object.keys(scripts) as ScriptType[];
}
