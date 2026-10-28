<h1><img src="https://raw.githubusercontent.com/supercheck-io/supercheck/main/supercheck-logo.png" alt="Supercheck logo" width="40" height="40" align="top"> Supercheck Recorder (Extension)</h1>

**Chrome and Edge extension for recording browser interactions and handing Playwright tests to the Supercheck Playground.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Supercheck_Recorder-blue?logo=googlechrome)](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)
[![Edge Add-ons](https://img.shields.io/badge/Microsoft_Edge-Supercheck_Recorder-0078D7?logo=microsoftedge)](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem)
[![Documentation](https://img.shields.io/badge/Docs-supercheck.io-blue)](https://supercheck.io/docs/recorder)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

---

## Features

- **Record Browser Interactions**: Capture clicks, typing, navigation, form inputs, and assertions in real time.
- **Send to Playground**: Recording started from Supercheck hands the generated script back to the originating Playground editor.
- **Seamless Authentication**: Automatically connects to Supercheck dashboard sessions without manual API key copying.
- **Playwright Test Output**: Recorded flows are generated and displayed as Playwright Test (JavaScript), the same format the Playground runs.
- **Resilient Locators**: Automatically generates `data-testid` and accessible role-based selectors.
- **Self-Hosted Support**: Full compatibility with Supercheck Cloud and self-hosted instances.

---

## Installation

### From official web stores (recommended)

- **Chrome Web Store**: [Supercheck Recorder on Chrome Web Store](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)
- **Microsoft Edge Add-ons**: [Supercheck Recorder on Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem)

### Developer build from source

1. Clone the repository and enter the recorder workspace:
   ```bash
   git clone https://github.com/supercheck-io/supercheck.git
   cd supercheck/recorder
   ```

2. Install dependencies and compile the extension:
   ```bash
   npm ci
   npm run build
   ```

3. Load the unpacked extension in Chrome or Edge:
   - Navigate to `chrome://extensions/` (or `edge://extensions/`).
   - Enable **Developer mode** toggle in the top right.
   - Click **Load unpacked**.
   - Select the `recorder/examples/recorder-crx/dist` directory.

---

## Usage

### Recording tests

1. Click the Supercheck Recorder icon or press `Shift+Alt+R`.
2. The recorder side panel opens.
3. Navigate to the page you want to test and perform your user journey.
4. Review and edit the generated Playwright code in the side panel editor.
5. Click **Save** in the recorder to insert the code into the originating Supercheck Playground editor, then save the test there.

### Connecting to Supercheck

#### Supercheck-hosted sites (Recommended)

The extension connects without setup on every first-party deployment:

| Instance | URL |
|---|---|
| Supercheck Cloud | `https://app.supercheck.io` |
| Live demo | `https://demo.supercheck.dev` |

1. Open one of those origins in the same browser profile.
2. Sign in and open any authenticated dashboard page.
3. Supercheck detects the extension and pairs it automatically.

The list lives in `src/supercheck/message-security.ts` (`SUPERCHECK_CLOUD_ORIGINS`) and is an exact-origin allowlist, not a wildcard. Adding a host is a security change: update that constant, the unit tests, and the recorder docs, then ship a new extension release.

#### Self-Hosted Supercheck
1. Right-click the extension icon and select **Options**.
2. Expand **Self-hosted instance** and enter the HTTPS origin of your instance (or `http://localhost:3000` for local development).
3. Click **Save**.
4. Sign in to your deployment; the extension connects automatically.

Self-hosted origins are not trusted until you save the URL: that explicit action is the trust decision for the origin. Changing the URL clears the credential saved for the previous instance so a key is never sent to a host it was not created for.

---

## Configuration & shortcuts

### Recorder options

- **Test ID Attribute**: Attribute name for locator generation (defaults to `data-testid`).
- **Side Panel Mode**: Open recorder in side panel (default: true; falls back to popup window if false).

Recorded flows are always generated as Playwright Test (JavaScript); the recorder does not expose a source/language chooser.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Shift+Alt+R` | Start recording |
| `Shift+Alt+C` | Start element inspection |

---

## Security

- Recorder-scoped credentials are stored in local extension storage (never synced to the browser account); treat the browser profile and installed extensions as trusted because extension storage is not a general-purpose secret vault.
- All network traffic uses HTTPS (except `localhost` development).
- Origin validation pins cloud communication to the exact first-party origins listed above plus the instance URL saved in Options; lookalike and non-HTTPS origins are rejected.
- Form inputs may be captured during recording; always inspect generated code before saving to avoid recording secrets.

---

## Development

### Project structure

```
examples/recorder-crx/
├── public/
│   └── manifest.json           # Extension Manifest V3
├── src/
│   ├── background.ts           # Extension service worker
│   ├── content-script.ts       # Web app bridge & messaging
│   ├── crxRecorder.tsx         # Recorder UI wrapper (Playwright Test output)
│   ├── dialog.tsx              # Shared dialog primitives
│   ├── index.tsx               # Side panel entry & player
│   ├── options.tsx             # Options page component
│   ├── preferences.tsx         # Recorder preferences UI
│   ├── preferencesForm.tsx     # Recorder preferences form
│   ├── saveCodeForm.tsx        # Save-to-Supercheck form
│   ├── settings.ts             # Settings & storage management
│   └── supercheck/             # Supercheck API integration
│       ├── api-client.ts       # HTTP client with retry logic
│       ├── config.ts           # Configuration management
│       ├── message-security.ts # Origin validation & security
│       └── components/         # Project selector & save dialogs
├── index.html
├── options.html
├── preferences.html
└── package.json
```

### Build commands

```bash
# From examples/recorder-crx/
npm run dev      # Build with watch mode
npm run build    # Production build
npm run lint     # ESLint checks
```

The extension imports the `playwright-crx` workspace library, so run the workspace build from `recorder/` (`npm run build` or `npm run build:crx`) before building the extension in isolation.

---

## Releases

App and extension versions are independent. To cut a recorder release:

1. Bump `version` in `public/manifest.json` and `package.json` (the publish workflow requires them to match) and add a `CHANGELOG.md` entry.
2. Merge to `main`.
3. Create and push a signed annotated tag: `git tag -s recorder-v<version> && git push origin recorder-v<version>`.

`.github/workflows/recorder-publish.yml` builds the ZIP, attaches it plus `SHA256SUMS.txt` to a GitHub release, and submits the same ZIP to the Chrome Web Store and Edge Add-ons (behind the `recorder-release` environment and `BPP_KEYS`). The GitHub asset is the supported install path for enterprise/air-gapped environments; it does not auto-update. Store submission is the only step that needs credentials: without `BPP_KEYS` the publish job fails, but the build and GitHub release still produce a sideloadable ZIP.

## API integration reference

### Web app message protocol

Communication between the web app and extension uses origin-validated `window.postMessage`:

| Message Type | Direction | Description |
|---|---|---|
| `SUPERCHECK_CHECK_EXTENSION` | App → Extension | Probe for extension availability |
| `SUPERCHECK_RECORDER_READY` | Extension → App | Extension announces presence and version |
| `SUPERCHECK_AUTO_CONNECT` | App → Extension | Pair extension with user session |
| `SUPERCHECK_EXTENSION_CONNECTED` | Extension → App | Confirm recorder-scoped credentials were stored |
| `SUPERCHECK_DISCONNECT_EXTENSION` | App → Extension | Revoke the recorder-scoped credential and clear configuration |
| `SUPERCHECK_EXTENSION_DISCONNECTED` | Extension → App | Confirm disconnection |
| `SUPERCHECK_STORE_RECORDING_CONTEXT` | App → Extension | Store bounded recorder context |
| `SUPERCHECK_RECORDING_CONTEXT_STORED` | Extension → App | Confirm recording context was stored |
| `SUPERCHECK_RECORDING_CONTEXT_ERROR` | Extension → App | Report a recording context storage failure |
| `SUPERCHECK_RECORDED_CODE` | Extension → App | Send recorded code to the authenticated app flow |
| `SUPERCHECK_REFRESH_REQUIRED` | Extension → App | Page must be refreshed after an extension update |
| `SUPERCHECK_API_CALL` | App → Extension | Bounded page API call (connection probe, context storage) |
| `SUPERCHECK_API_RESPONSE` | Extension → App | Result of a page API call |

### Backend API endpoints

- `GET /api/extension/projects` - List accessible projects for current user
- `POST /api/auth/verify-key` - Validate API key
- `POST /api/extension/auth` - Create or reuse a recorder-scoped key for an authenticated dashboard session
- `DELETE /api/extension/auth` - Revoke recorder-scoped keys for the authenticated session

---

## License

This package is distributed under the [Apache-2.0 License](../../LICENSE). Upstream attribution for Playwright CRX and Microsoft Playwright is preserved in [`../../NOTICE`](../../NOTICE) and [`../../playwright/NOTICE`](../../playwright/NOTICE).
