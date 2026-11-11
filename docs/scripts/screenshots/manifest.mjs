// One entry per docs screenshot. Keep file names stable: docs MDX and src/lib/{products,solutions}.ts reference them.
//
// Entry fields
//   file      PNG name written to OUT_DIR (site entries also write site/<name>.webp)
//   path      route to open (relative to BASE_URL)
//   open      optional second hop: after `path` loads, follow the first link whose href starts with
//             `prefix` (and, when given, whose text contains `text`; hrefs containing "create" are skipped).
//             `to` rewrites the target, `{id}` is the segment after `prefix`. When the page has no such link the
//             table row is clicked instead (or its "..." menu item matching `menu`) and the URL must reach `prefix`.
//   actions   ordered steps, run after load:
//               { click: <target> }  { fill: <target + value> }  { waitFor: <target> }  { press: "Escape" }
//             <target> is one of { role, name } | { text } | { label } | { placeholder } | { selector },
//             plus optional { nth } (0-based, default 0).
//   viewport  "desktop" (default, 1440x900@2x) | "mobile" (390x844@3x)
//   site      true when site/<name>.webp is also used by the landing page
//   needs     data/permission the demo must have; the capture still runs, the note is reported when it fails
//   external  not a screenshot of the app (mail client, chat app): always skipped, recapture by hand
//   skip      reason this shot is not automated at all
//
// Screenshots hold exactly what the docs text describes; a failed step prints the step so the entry is easy to fix.

const btn = (name) => ({ role: "button", name });
const tab = (name) => ({ role: "tab", name });
const text = (t) => ({ text: t });

export const manifest = [
  // ---- Variables / secrets
  { file: "variables-list.png", path: "/variables" },
  {
    file: "add-variable.png", path: "/variables",
    actions: [{ click: btn("Add Variable") }, { waitFor: text("Variable Name") },
      { fill: { label: "Variable Name", value: "CHECKOUT_URL" } },
      { fill: { label: "Value", value: "https://shop.acme.example/checkout" } },
      { fill: { label: "Description", value: "Checkout page used by the browser tests" } }],
  },
  {
    file: "add-secret.png", path: "/variables",
    actions: [{ click: btn("Add Variable") }, { waitFor: text("Variable Name") },
      { click: { role: "combobox", nth: 0 } }, { click: { role: "option", name: /secret/i } },
      { fill: { label: "Variable Name", value: "PAYMENTS_API_KEY" } },
      { fill: { label: "Value", value: "sk_demo_not_a_real_key" } },
      { fill: { label: "Description", value: "Sandbox key for the payments API tests" } }],
  },

  // ---- Tests / playground / AI
  { file: "tests-list.png", path: "/tests" },
  { file: "quick-create.png", path: "/create" },
  {
    file: "playground-editor.png", path: "/tests", site: true,
    open: { prefix: "/playground/", text: "Checkout: add item" },
    actions: [{ waitFor: { selector: ".monaco-editor" } }],
  },
  {
    file: "playground-report.png", path: "/tests",
    open: { prefix: "/playground/", text: "Orders API returns" },
    actions: [{ click: tab("Report") }],
    needs: "a completed run of 'Orders API returns order' (open its Report tab)",
  },
  {
    file: "code-template.png", path: "/tests",
    open: { prefix: "/playground/", text: "Promo banner" },
    actions: [{ click: btn("Templates") }, { waitFor: text("Code Templates") }],
  },
  {
    file: "ai-create-prompt.png", path: "/tests",
    open: { prefix: "/playground/", text: "Promo banner" },
    actions: [{ click: btn("AI Create") }, { waitFor: text("What do you want to test?") },
      { fill: { placeholder: /describe/i, value: "GET https://jsonplaceholder.typicode.com/todos/1 returns 200 with id, title and a boolean completed field. Also POST /todos creates an item and returns 201." } }],
    needs: "ai",
  },
  {
    file: "ai-create-result-dialog.png", path: "/tests",
    open: { prefix: "/playground/", text: "Promo banner" },
    actions: [{ click: btn("AI Create") }, { waitFor: text("What do you want to test?") },
      { fill: { placeholder: /describe/i, value: "GET https://jsonplaceholder.typicode.com/todos/1 returns 200 with id, title and a boolean completed field. Also POST /todos creates an item and returns 201." } },
      { click: btn("Generate") }, { waitFor: { text: "Apply to Editor", timeout: 90000 } }],
    needs: "ai (live provider call)",
  },
  {
    file: "ai-fix-button.png", path: "/tests", site: true,
    open: { prefix: "/playground/", text: "Promo banner" },
    actions: [{ click: tab("Report") }, { waitFor: text("AI Fix") }],
    needs: "a failed run of 'Promo banner shows discount' so the AI Fix button appears",
  },
  {
    file: "ai-fix-result-dialog.png", path: "/tests",
    open: { prefix: "/playground/", text: "Promo banner" },
    actions: [{ click: tab("Report") }, { click: btn("AI Fix") }, { waitFor: { text: "AI Fix Review", timeout: 90000 } }],
    needs: "ai + a failed run of 'Promo banner shows discount'",
  },
  {
    file: "parallel-execution-dialog.png", path: "/jobs",
    actions: [{ click: { text: "PARALLEL" } }, { waitFor: text("Parallel Executions") }],
  },

  // ---- Performance (k6) tests
  {
    file: "performance-test-editor.png", path: "/tests",
    open: { prefix: "/playground/", text: "Checkout API load" },
    actions: [{ waitFor: { selector: ".monaco-editor" } }],
  },
  {
    file: "performance-test-report.png", path: "/tests",
    open: { prefix: "/playground/", text: "Checkout API load" },
    actions: [{ click: tab("Report") }],
    needs: "a completed k6 run of 'Checkout API load test'",
  },
  {
    file: "performance-test-result-logs.png", path: "/tests",
    open: { prefix: "/playground/", text: "Checkout API load" },
    actions: [{ click: tab("Report") }, { click: { text: "Logs" } }],
    needs: "a completed k6 run of 'Checkout API load test'",
  },
  {
    file: "performance-test-streaming-logs.png", path: "/tests",
    open: { prefix: "/playground/", text: "Checkout API load" },
    actions: [{ click: tab("Report") }, { click: { text: "Logs" } }],
    needs: "a k6 run in progress (logs mid-stream); automation shows the finished log instead",
  },

  // ---- Jobs
  { file: "jobs-list.png", path: "/jobs" },
  { file: "job-runs.png", path: "/runs" },
  { file: "create-job-form.png", path: "/jobs/create/playwright" },
  {
    file: "create-job-select-tests.png", path: "/jobs/create/playwright",
    actions: [{ fill: { label: /job name/i, value: "Nightly regression" } },
      { fill: { label: /description/i, value: "Full browser and API suite before the morning release" } },
      { click: btn("Select Tests") }, { waitFor: text("Add Selected Tests") },
      { click: { role: "checkbox", nth: 2 } }, { click: { role: "checkbox", nth: 3 } }],
  },
  {
    file: "create-job-alerts-config.png", path: "/jobs/create/playwright",
    actions: [{ fill: { label: /job name/i, value: "Nightly regression" } },
      { click: btn("Select Tests") }, { waitFor: text("Add Selected Tests") },
      { click: { role: "checkbox", nth: 2 } }, { click: btn("Add Selected Tests") },
      { click: btn("Next: Alert Settings") }, { waitFor: text("Alert Settings") }],
    needs: "at least one test, plus notification channels (Teams, webhook, Slack) so the channel cards render",
  },
  {
    file: "edit-job-add-cicd-apikey-1.png", path: "/jobs",
    open: { prefix: "/jobs/edit/", menu: /edit/i },
    actions: [{ click: btn(/^Next/) }, { click: btn(/^Next/) }, { click: btn("Create Key") }, { waitFor: text("Create API Key") }],
    needs: "an existing job; the CI/CD step is the last wizard step",
  },
  {
    file: "edit-job-add-cicd-apikey-2.png", path: "/jobs",
    open: { prefix: "/jobs/edit/", menu: /edit/i },
    actions: [{ click: btn(/^Next/) }, { click: btn(/^Next/) }, { click: btn("Create Key") }, { fill: { label: /key name/i, value: "GitLab Runner" } },
      { click: { selector: '[role=dialog] button:has-text("Create Key")' } }, { waitFor: text("API Key Created Successfully") }],
    needs: "creates a real trigger key on the demo job; delete it afterwards",
  },
  {
    file: "edit-job-cicd-apikey-configure.png", path: "/jobs",
    open: { prefix: "/jobs/edit/", menu: /edit/i },
    actions: [{ click: btn(/^Next/) }, { click: btn(/^Next/) }, { waitFor: text("CI/CD Settings") }],
    needs: "a job that already has an active API key named 'GitLab Runner'",
  },

  // ---- Dashboards
  { file: "dashboard.png", path: "/", site: true },
  {
    file: "dashboard-k6-analytics.png", path: "/runs",
    actions: [{ click: { text: "Performance (k6)" } }],
    needs: "two or more k6 runs of one job (Weekly load test)",
  },
  {
    file: "dashboard-playwright-analytics.png", path: "/runs",
    actions: [{ click: { text: "Browser (Playwright)" } }],
    needs: "Playwright job runs over the last 30 days",
  },
  {
    file: "dashboard-k6-compare-dialog.png", path: "/runs",
    actions: [{ click: { text: "Performance (k6)" } }, { click: btn("Compare Runs") }, { waitFor: text("Run Comparison") }],
    needs: "two k6 runs of one job",
  },
  {
    file: "dashboard-k6-report-comparison.png", path: "/runs", site: true,
    actions: [{ click: { text: "Performance (k6)" } }, { click: btn("Compare Runs") }, { waitFor: text("Run Comparison") },
      { click: btn("View k6 Reports") }, { waitFor: text("HTTP Performance overview") }],
    needs: "two k6 runs of one job with HTML reports",
  },
  {
    file: "dashboard-k6-ai-report-comparison.png", path: "/runs",
    actions: [{ click: { text: "Performance (k6)" } }, { click: btn("Compare Runs") }, { waitFor: text("Run Comparison") },
      { click: btn("AI Analyze") }, { waitFor: { text: "Performance Comparison Analysis", timeout: 90000 } }],
    needs: "ai + two k6 runs of one job",
  },

  // ---- Monitors
  { file: "monitors-list.png", path: "/monitors", site: true },
  {
    file: "monitor-details.png", path: "/monitors", site: true,
    open: { prefix: "/monitors/", text: "Public API" },
    actions: [{ waitFor: text("Recent Check Results") }],
    needs: "a monitor named 'Public API' with check history",
  },
  {
    file: "monitor-report.png", path: "/monitors",
    open: { prefix: "/monitors/", text: "Checkout journey" },
    actions: [{ click: { text: "View Report" } }, { waitFor: text("Monitor Report") }],
    needs: "a synthetic monitor with a failed run that has a Playwright report",
  },
  { file: "create-http-monitor.png", path: "/monitors/create?type=http_request", site: true,
    actions: [{ fill: { label: /monitor name/i, value: "Public API" } }, { fill: { label: /target/i, value: "https://api.acme.example/v1/health" } }] },
  { file: "create-website-monitor.png", path: "/monitors/create?type=website",
    actions: [{ fill: { label: /monitor name/i, value: "Storefront" } }, { fill: { label: /target/i, value: "https://shop.acme.example" } }] },
  { file: "create-ping-monitor.png", path: "/monitors/create?type=ping_host",
    actions: [{ fill: { label: /monitor name/i, value: "Edge resolver" } }, { fill: { label: /target/i, value: "1.1.1.1" } }] },
  { file: "create-port-monitor.png", path: "/monitors/create?type=port_check",
    actions: [{ fill: { label: /monitor name/i, value: "API gateway :443" } }, { fill: { label: /target/i, value: "api.acme.example" } }] },
  {
    file: "create-synthetic-monitor.png", path: "/monitors/create?type=synthetic_test", site: true,
    actions: [{ fill: { label: /monitor name/i, value: "Checkout journey" } }],
    needs: "at least one browser test; pick it in 'Selected Tests' by hand if the shot shows none",
  },
  {
    file: "create-monitor-alerts-setting.png", path: "/monitors/create?type=http_request",
    actions: [{ fill: { label: /monitor name/i, value: "Public API" } }, { fill: { label: /target/i, value: "https://api.acme.example/v1/health" } },
      { click: btn("Next: Alert Settings") }, { waitFor: text("Alert Settings") }],
    needs: "notification channels (Teams, webhook, Slack) so the channel cards render",
  },

  // ---- Alerts and notifications
  { file: "notification-channels.png", path: "/notifications", site: true },
  { file: "alert-history.png", path: "/alerts", actions: [{ click: { text: "History" } }],
    needs: "alert history rows (webhook alerts) in the demo" },
  // External apps: phone/desktop screenshots of Discord, Gmail, Slack, Teams. Not capturable from the app.
  { file: "alert-discord.png", external: "Discord mobile app showing the webhook message" },
  { file: "alert-email-job.png", external: "Gmail mobile app showing the job-completed email" },
  { file: "alert-email-monitor.png", external: "Gmail mobile app showing the monitor-down email" },
  { file: "alert-slack.png", external: "Slack mobile app showing the alert messages" },
  { file: "alert-teams-job.png", external: "Microsoft Teams card for a completed job" },
  { file: "alert-teams-monitor.png", external: "Microsoft Teams card for a monitor going down" },

  // ---- Incidents / SRE
  { file: "incident-workspace-overview.png", path: "/incidents", site: true,
    open: { prefix: "/incidents/", text: "Checkout API 5xx" }, actions: [{ click: tab("Overview") }],
    needs: "seeded incident #6 'Checkout API 5xx spike after connection pool change'" },
  { file: "incident-evidence-brief.png", path: "/incidents",
    open: { prefix: "/incidents/", text: "Checkout API 5xx" }, actions: [{ click: tab("Investigation") }],
    needs: "seeded incident #6 with a finished investigation" },
  { file: "incident-postmortem.png", path: "/incidents",
    open: { prefix: "/incidents/", text: "Payments capture failures" }, actions: [{ click: tab("Post-mortem") }],
    needs: "seeded resolved incident #7 with a post-mortem" },
  { file: "create-incident-dialog.png", path: "/incidents",
    actions: [{ click: btn("New incident") }, { waitFor: text("Create incident") },
      { fill: { label: /title/i, value: "Checkout API 504s after deploy" } },
      { fill: { label: /initial notes/i, value: "Checkout p95 above 2s since 14:05 UTC, right after checkout-api v2.15.0 rolled out. Payments look healthy." } }] },
  { file: "sre-incidents-queue.png", path: "/incidents", needs: "seeded incidents" },
  { file: "sre-incident-trends.png", path: "/incidents/analytics", needs: "seeded incidents for the last 30 days" },
  { file: "sre-copilot-chat.png", path: "/copilot", site: true, needs: "ai (empty-state copilot, no message sent)" },
  { file: "sre-services-catalog.png", path: "/services", needs: "seeded services" },
  { file: "sre-service-detail.png", path: "/services", open: { prefix: "/services/", text: "checkout-api" },
    needs: "seeded service 'checkout-api' with incidents and alerts" },
  { file: "sre-add-service-dialog.png", path: "/services",
    actions: [{ click: btn("Add service") }, { waitFor: text("Service name") },
      { fill: { label: /service name/i, value: "search-api" } }] },
  { file: "sre-add-connector-dialog.png", path: "/org-admin", site: true,
    actions: [{ click: tab("Integrations") }, { click: btn("Add connector") }, { waitFor: text("Connector type") }],
    needs: "org admin role" },
  { file: "sre-integrations-saved-queries.png", path: "/org-admin",
    actions: [{ click: tab("Integrations") }, { waitFor: text("Saved queries") }],
    needs: "org admin role + one connector and one saved query" },

  // ---- Requirements
  { file: "requirements-list.png", path: "/requirements", site: true },

  // ---- Status pages
  { file: "status-pages-list.png", path: "/status-pages" },
  { file: "status-page-create.png", path: "/status-pages",
    actions: [{ click: btn("Create Status Page") }, { waitFor: text("Status Page Name") },
      { fill: { label: /status page name/i, value: "Acme API Status" } },
      { fill: { label: /headline/i, value: "Acme API status" } },
      { fill: { label: /description/i, value: "Availability of the public Acme REST API" } }] },
  { file: "status-page-overview.png", path: "/status-pages", open: { prefix: "/status-pages/" },
    needs: "a published status page with linked monitors" },
  { file: "status-page-components.png", path: "/status-pages", site: true, open: { prefix: "/status-pages/" },
    actions: [{ click: tab("Components") }], needs: "a status page with components" },
  { file: "status-page-add-component.png", path: "/status-pages", open: { prefix: "/status-pages/" },
    actions: [{ click: tab("Components") }, { click: btn("Add Component") }, { waitFor: text("Add Component") }] },
  { file: "status-page-incidents.png", path: "/status-pages", open: { prefix: "/status-pages/" },
    actions: [{ click: tab("Status updates") }], needs: "a published status update" },
  { file: "status-page-create-incident.png", path: "/status-pages", site: true, open: { prefix: "/status-pages/" },
    actions: [{ click: tab("Status updates") }, { click: btn("New status update") }, { waitFor: text("Initial Message") },
      { fill: { label: /title/i, value: "Payments degraded for some card types" } }],
    needs: "a status page with components" },
  { file: "status-page-settings.png", path: "/status-pages", open: { prefix: "/status-pages/" }, actions: [{ click: tab("Settings") }] },
  { file: "status-page-subscribers.png", path: "/status-pages", open: { prefix: "/status-pages/" },
    actions: [{ click: tab("Subscribers") }], needs: "seeded subscribers (verified, pending, webhook, Slack)" },
  { file: "status-page-external.png", path: "/status-pages", open: { prefix: "/status-pages/", to: "/status/{id}" },
    needs: "a published status page" },
  { file: "status-page-public.png", path: "/status-pages", open: { prefix: "/status-pages/", to: "/status/{id}" }, site: true,
    needs: "a published status page (same capture as status-page-external, site copy only)", siteOnly: true },
  { file: "status-page-incident-external.png", path: "/status-pages", open: { prefix: "/status-pages/", to: "/status/{id}" },
    actions: [{ click: { selector: 'a[href*="/incidents/"]' } }],
    needs: "a published status page with a public incident ('Delayed order confirmation emails')" },
  { file: "status-page-subscribe-email.png", path: "/status-pages", open: { prefix: "/status-pages/", to: "/status/{id}" },
    actions: [{ click: btn("Subscribe") }, { fill: { label: /email address/i, value: "ops@acme.example" } }] },
  { file: "status-page-subscribe-slack.png", path: "/status-pages", open: { prefix: "/status-pages/", to: "/status/{id}" },
    actions: [{ click: btn("Subscribe") }, { click: { text: "Slack" } }, { fill: { label: /webhook url/i, value: "https://hooks.slack.com/services/..." } }] },

  // ---- Org admin
  { file: "org-admin-overview.png", path: "/org-admin", needs: "org admin role" },
  { file: "org-admin-projects.png", path: "/org-admin", needs: "org admin role" },
  { file: "org-admin-audit-list.png", path: "/org-admin", actions: [{ click: tab("Audit") }], needs: "org admin role + audit log rows" },
  { file: "org-admin-create-project.png", path: "/org-admin",
    actions: [{ click: btn("Create Project") }, { waitFor: text("Create New Project") },
      { fill: { label: /^name/i, value: "Staging" } }, { fill: { label: /description/i, value: "Pre-release checks for the staging environment" } }],
    needs: "org admin role" },
  { file: "org-admin-member-invite-dialog.png", path: "/org-admin", site: true,
    actions: [{ click: tab("Members") }, { click: btn("Invite Member") }, { waitFor: text("Email Address") },
      { fill: { label: /email address/i, value: "priya.shah@acme.example" } }],
    needs: "org admin role" },
  // Needs an invitation token / a real mailbox
  { file: "org-admin-member-email-invitation.png", external: "Gmail inbox showing the invitation email" },
  { file: "org-admin-member-invite-acceptance.png", skip: "needs a live invitation token: /invite/<token> (sending one emails a real address)" },
  { file: "org-admin-member-invite-signup.png", skip: "needs a live invitation token: /invite/<token> (sending one emails a real address)" },

  // ---- Super admin (needs the super-admin role)
  { file: "super-admin-overview.png", path: "/super-admin", needs: "superAdmin" },
  { file: "super-admin-users.png", path: "/super-admin", actions: [{ click: tab("Users") }], needs: "superAdmin" },
  { file: "super-admin-organizations.png", path: "/super-admin", actions: [{ click: tab("Organizations") }], needs: "superAdmin" },
  { file: "super-admin-bullmq-queues.png", path: "/super-admin", actions: [{ click: tab("Queues") }, { waitFor: text("Bull Dashboard") }], needs: "superAdmin" },
  { file: "super-admin-ban-user.png", path: "/super-admin",
    actions: [{ click: tab("Users") }, { click: { selector: "tbody tr:nth-child(2) button:last-child" } }, { click: { role: "menuitem", name: /ban/i } }, { waitFor: text("Ban User") },
      { fill: { label: /ban reason/i, value: "Repeated abuse of the public API from this account; see ticket SEC-1042." } }],
    needs: "superAdmin (dialog is opened, never confirmed)" },
  { file: "super-admin-impersonate-user.png", path: "/super-admin",
    actions: [{ click: tab("Users") }, { click: { selector: "tbody tr:nth-child(2) button:last-child" } }, { click: { role: "menuitem", name: /impersonate/i } }, { waitFor: text("Impersonate User") }],
    needs: "superAdmin (dialog is opened, never confirmed)" },
  { file: "super-admin-impersonation-banner.png", skip: "needs a live impersonation session; starting one swaps the signed-in user, capture by hand" },
];
