<h1><img src="https://raw.githubusercontent.com/supercheck-io/supercheck/main/supercheck-logo.png" alt="Supercheck logo" width="40" height="40" align="top"> Supercheck Recorder (Extension)</h1>

**Chrome and Edge extension for recording browser interactions and saving Playwright tests directly to Supercheck.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Supercheck_Recorder-blue?logo=googlechrome)](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)
[![Edge Add-ons](https://img.shields.io/badge/Microsoft_Edge-Supercheck_Recorder-0078D7?logo=microsoftedge)](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/0rdckc265vb9)
[![Documentation](https://img.shields.io/badge/Docs-supercheck.io-blue)](https://supercheck.io/docs/recorder)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

---

## Features

- **Record Browser Interactions**: Capture clicks, typing, navigation, form inputs, and assertions in real time.
- **Save to Supercheck**: One-click upload of recorded scripts directly into your Supercheck projects.
- **Project Selection**: Easily choose destination projects from your Supercheck organizations.
- **Seamless Authentication**: Automatically connects to Supercheck dashboard sessions without manual API key copying.
- **Multi-Language Display**: View recorded scripts in TypeScript, JavaScript, Python, Java, or C#; tests saved to Supercheck use JavaScript.
- **Resilient Locators**: Automatically generates `data-testid` and accessible role-based selectors.
- **Self-Hosted Support**: Full compatibility with Supercheck Cloud and self-hosted instances.

---

## Installation

### From official web stores (recommended)

- **Chrome Web Store**: [Supercheck Recorder on Chrome Web Store](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)
- **Microsoft Edge Add-ons**: [Supercheck Recorder on Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/0rdckc265vb9)

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
5. Click **Save to Supercheck**, select the target project, and save your test.

### Connecting to Supercheck

#### Supercheck Cloud (Recommended)
1. Open `https://app.supercheck.io` in the same browser profile.
2. Sign in and open any authenticated dashboard page.
3. Supercheck detects the extension and pairs it automatically.

#### Self-Hosted Supercheck
1. Right-click the extension icon and select **Options**.
2. Enter the HTTPS origin of your Supercheck instance (or `http://localhost:3000` for local development).
3. Click **Save URL and open Supercheck**.
4. Sign in to your deployment; the extension connects automatically.

> The API-key field in Options is strictly reserved for existing recorder-scoped credentials (`ext_*`). CLI tokens and trigger keys cannot upload recordings.

---

## Configuration & shortcuts

### Recorder options

- **Default Language**: Choose default display language (TypeScript, JavaScript, Python, Java, C#).
- **Test ID Attribute**: Attribute name for locator generation (defaults to `data-testid`).
- **Side Panel Mode**: Open recorder in side panel (default: true; falls back to popup window if false).

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Shift+Alt+R` | Start / pause recording |
| `Shift+Alt+C` | Start / pause element inspector |

---

## Security

- Recorder-scoped credentials are stored in Chrome sync storage; treat the browser profile and installed extensions as trusted because extension storage is not a general-purpose secret vault.
- All network traffic uses HTTPS (except `localhost` development).
- Origin validation pins cloud communication to `app.supercheck.io` and `supercheck.io`.
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
│   ├── index.tsx               # Side panel entry & player
│   ├── options.tsx             # Options page component
│   ├── settings.ts             # Settings & storage management
│   └── supercheck/             # Supercheck API integration
│       ├── api-client.ts       # HTTP client with retry logic
│       ├── config.ts           # Configuration management
│       ├── message-security.ts # Origin validation & security
│       └── components/         # Project selector & save dialogs
├── options.html
├── index.html
└── package.json
```

### Build commands

```bash
# From examples/recorder-crx/
npm run dev      # Build with watch mode
npm run build    # Production build
npm run lint     # ESLint checks
```

---

## API integration reference

### Web app message protocol

Communication between the web app and extension uses origin-validated `window.postMessage`:

| Message Type | Direction | Description |
|---|---|---|
| `SUPERCHECK_CHECK_EXTENSION` | App → Extension | Probe for extension availability |
| `SUPERCHECK_RECORDER_READY` | Extension → App | Extension announces presence and version |
| `SUPERCHECK_AUTO_CONNECT` | App → Extension | Pair extension with user session |
| `SUPERCHECK_EXTENSION_CONNECTED` | Extension → App | Confirm recorder-scoped credentials were stored |
| `SUPERCHECK_STORE_RECORDING_CONTEXT` | App → Extension | Store bounded recorder context |
| `SUPERCHECK_RECORDED_CODE` | Extension → App | Send recorded code to the authenticated app flow |

### Backend API endpoints

- `GET /api/extension/projects` - List accessible projects for current user
- `POST /api/recordings` - Save recorded test script
- `POST /api/auth/verify-key` - Validate API key
- `POST /api/extension/auth` - Create or reuse a recorder-scoped key for an authenticated dashboard session

---

## License

This package is distributed under the [Apache-2.0 License](../../LICENSE). Upstream attribution for Playwright CRX and Microsoft Playwright is preserved in [`../../NOTICE`](../../NOTICE) and [`../../playwright/NOTICE`](../../playwright/NOTICE).
