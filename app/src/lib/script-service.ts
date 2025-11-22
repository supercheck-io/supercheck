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
  Performance = "performance",
}

// Sample scripts content
const scripts: Record<ScriptType, string> = {
  [ScriptType.Browser]: `/**
 * Browser automation tests with Playwright
 * Demonstrates web page navigation, element interaction, and form testing
 * @requires '@playwright/test'
 */

import { test, expect } from '@playwright/test';

test.describe('browser automation tests', () => {
  test('page title verification', async ({ page }) => {
    // Navigate to Playwright docs and verify page title
    await page.goto('https://playwright.dev/');
    await expect(page).toHaveTitle(/Playwright/);
    console.log('✅ Page title verified successfully');
  });

  test('navigation and element visibility', async ({ page }) => {
    // Test navigation flow and element interaction
    await page.goto('https://playwright.dev/');
    await page.getByRole('link', { name: 'Get started' }).click();
    await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
    console.log('✅ Navigation and element visibility verified');
  });

  test('form interaction', async ({ page }) => {
    // Test form input and submission in TodoMVC app
    await page.goto('https://demo.playwright.dev/todomvc');
    await page.getByPlaceholder('What needs to be done?').fill('Test automation with Playwright');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await expect(page.getByTestId('todo-title')).toHaveText(['Test automation with Playwright']);
    console.log('✅ Form interaction verified');
  });
});
`,

  [ScriptType.API]: `/**
 * REST API testing with Playwright
 * Tests HTTP methods, response validation, and error handling
 * @requires '@playwright/test'
 */

import { test, expect } from '@playwright/test';

test.describe('API endpoint tests', () => {
  test('GET request with status and data validation', async ({ request }) => {
    // Test GET request and validate response structure
    const response = await request.get('https://jsonplaceholder.typicode.com/todos/1');
    expect(response.status()).toBe(200);
    const responseData = await response.json();
    expect(responseData).toEqual({
      userId: 1,
      id: 1,
      title: 'delectus aut autem',
      completed: false,
    });
    console.log('✅ GET request validated successfully');
  });

  test('POST request with request body', async ({ request }) => {
    // Test POST request with data payload
    const newTodo = {
      title: 'Test API with Playwright',
      completed: false,
      userId: 1
    };
    const response = await request.post('https://jsonplaceholder.typicode.com/todos', {
      data: newTodo
    });
    expect(response.status()).toBe(201);
    const responseData = await response.json();
    expect(responseData).toHaveProperty('id');
    expect(responseData.title).toBe(newTodo.title);
    console.log('✅ POST request validated successfully');
  });

  test('error handling for non-existent resource', async ({ request }) => {
    // Test 404 error handling for missing resources
    const response = await request.get('https://jsonplaceholder.typicode.com/todos/999999');
    expect(response.status()).toBe(404);
    const responseData = await response.json();
    expect(Object.keys(responseData).length).toBe(0);
    console.log('✅ Error handling validated successfully');
  });
});
`,

  [ScriptType.Database]: `/**
 * PostgreSQL database connection and query testing
 * Connects to public database and executes SQL queries with validation
 * @requires 'pg' package, '@playwright/test'
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";

const config = {
  connectionString: "postgres://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs",
  ssl: false
};

test.describe('database query tests', () => {
  test('connection and basic info', async () => {
    // Test database connection and retrieve basic information
    const client = new Client(config);
    
    try {
      await client.connect();
      console.log("✅ Connected to RNAcentral PostgreSQL database");

      // Get database version and connection details
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

      // Check server configuration
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

  test('schema discovery', async () => {
    // Discover database schemas and available tables
    const client = new Client(config);
    
    try {
      await client.connect();
      console.log("✅ Connected to RNAcentral PostgreSQL database");

      // Find all non-system schemas
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

      // List first 5 tables in each schema
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
});

`,

  [ScriptType.Custom]: `/**
 * GitHub API + Browser integration tests
 * Combines API data fetching with browser validation for end-to-end testing
 * @requires '@playwright/test'
 */

import { test, expect } from "@playwright/test";

test.describe('GitHub integration tests', () => {
  test('repository analysis - API + browser integration', async ({ request, page }) => {
    // Combine API data fetching with browser validation
    console.log("🚀 Starting GitHub repository analysis workflow...");

    const repoOwner = "microsoft";
    const repoName = "playwright";

    console.log("Step 1: Fetching repository data via GitHub API...");
    const repoResponse = await request.get(
      \`https://api.github.com/repos/\${repoOwner}/\${repoName}\`
    );

    expect(repoResponse.status()).toBe(200);
    const repoData = await repoResponse.json();
    
    // Display repository metrics from API
    console.log(\`📊 Repository: \${repoData.full_name}\`);
    console.log(\`⭐ Stars: \${repoData.stargazers_count}\`);
    console.log(\`🍴 Forks: \${repoData.forks_count}\`);
    console.log(\`📝 Description: \${repoData.description}\`);
    console.log(\`🔗 Language: \${repoData.language}\`);

    console.log("Step 2: Opening GitHub repository in browser...");
    await page.goto(\`https://github.com/\${repoOwner}/\${repoName}\`);
    await expect(page).toHaveTitle(/playwright/i);
    
    console.log("Step 3: Validating API data against browser content...");
    await expect(page.getByRole('heading', { name: '🎭 Playwright' })).toBeVisible();
    console.log(\`✅ Repository page loaded and confirmed\`);

    console.log("✅ Repository analysis completed successfully");
  });

  test('API data analysis', async ({ request }) => {
    // Analyze GitHub repository issues and contributors via API
    console.log("🚀 Starting GitHub API data analysis...");

    const repoOwner = "microsoft";
    const repoName = "playwright";

    console.log("Step 1: Fetching repository issues via API...");
    const issuesResponse = await request.get(
      \`https://api.github.com/repos/\${repoOwner}/\${repoName}/issues?state=open&per_page=10\`
    );

    expect(issuesResponse.status()).toBe(200);
    const issues = await issuesResponse.json();
    
    console.log(\`📋 Found \${issues.length} open issues (showing first 10)\`);
    
    // Analyze issue patterns and statistics
    const issueAnalysis = {
      withLabels: issues.filter(issue => issue.labels.length > 0).length,
      withAssignees: issues.filter(issue => issue.assignees.length > 0).length,
      averageComments: Math.round(issues.reduce((sum, issue) => sum + issue.comments, 0) / issues.length)
    };

    console.log(\`🏷️  Issues with labels: \${issueAnalysis.withLabels}/\${issues.length}\`);
    console.log(\`👥 Issues with assignees: \${issueAnalysis.withAssignees}/\${issues.length}\`);
    console.log(\`💬 Average comments per issue: \${issueAnalysis.averageComments}\`);

    console.log("Step 2: Fetching repository contributors...");
    const contributorsResponse = await request.get(
      \`https://api.github.com/repos/\${repoOwner}/\${repoName}/contributors?per_page=5\`
    );

    expect(contributorsResponse.status()).toBe(200);
    const contributors = await contributorsResponse.json();
    
    // Display top contributors by commit count
    console.log(\`👨‍💻 Top \${contributors.length} Contributors:\`);
    contributors.forEach((contributor, index) => {
      console.log(\`  \${index + 1}. \${contributor.login} - \${contributor.contributions} contributions\`);
    });

    expect(contributors.length).toBeGreaterThan(0);
    console.log("✅ API data analysis completed successfully");
  });

  test('user profile analysis', async ({ request, page }) => {
    // Validate user profile data across API and browser interfaces
    console.log("🚀 Starting GitHub user profile analysis...");

    const username = "torvalds";

    console.log("Step 1: Fetching user profile via GitHub API...");
    const userResponse = await request.get(\`https://api.github.com/users/\${username}\`);

    expect(userResponse.status()).toBe(200);
    const userData = await userResponse.json();
    
    // Display user profile information from API
    console.log(\`👤 User: \${userData.login}\`);
    console.log(\`📝 Name: \${userData.name || 'Not provided'}\`);
    console.log(\`📊 Public Repos: \${userData.public_repos}\`);
    console.log(\`👥 Followers: \${userData.followers}\`);

    console.log("Step 2: Validating user profile in browser...");
    await page.goto(\`https://github.com/\${username}\`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(username));
    console.log(\`✅ Confirmed on \${username}'s profile page\`);

    console.log("✅ User profile analysis completed successfully");
  });
});

`,

  [ScriptType.Performance]: `/**
 * k6 performance testing script
 * Load testing with virtual users and response time thresholds
 * @requires k6 binary
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function() {
  const response = http.get('https://test-api.k6.io/public/crocodiles/');

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}`,
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
function getDefaultScript() {
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
