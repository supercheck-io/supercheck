# Supercheck Recorder

A Chrome extension for recording browser interactions and saving them as Playwright tests directly to Supercheck.

## Features

- **Record Browser Interactions**: Capture clicks, navigation, form inputs, and more
- **Save to Supercheck**: One-click save recorded scripts directly to your Supercheck projects
- **Project Selection**: Choose which project to save tests to
- **Seamless Authentication**: Connect to Supercheck without copying API keys
- **Multi-Language Display**: View recorded scripts in JavaScript, TypeScript, Python, Java, or C#
- **Self-Hosted Support**: Works with both Supercheck Cloud and self-hosted deployments

## Installation

### From Chrome Web Store (Recommended)

1. Visit the [Chrome Web Store](https://chrome.google.com/webstore)
2. Search for "Supercheck Recorder"
3. Click "Add to Chrome"

### Development / Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/supercheck-io/supercheck.git
   cd supercheck/recorder
   ```

2. Install dependencies:
   ```bash
   npm ci
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `examples/recorder-crx/dist` directory

## Usage

### Recording Tests

1. Click the Supercheck Recorder icon in Chrome or use the keyboard shortcut `Shift+Alt+R`
2. The recorder side panel will open
3. Navigate to the page you want to test
4. Interact with the page - your actions will be recorded
5. Click "Save to Supercheck" to save the test

### Connecting to Supercheck

#### Supercheck Cloud (Recommended)

1. Log in to Supercheck in your browser
2. Open any authenticated dashboard page in the same browser profile as the extension
3. Supercheck detects and configures the extension automatically

#### Self-Hosted Supercheck

1. Click the extension icon and select "Options"
2. Enter the HTTPS origin of your Supercheck instance
3. Click "Save URL and open Supercheck"
4. Sign in and open an authenticated dashboard page; the extension connects automatically

The API-key field is only for an existing recorder-scoped credential. Ordinary CLI tokens and job trigger keys cannot upload recorder results.

## Configuration

### Instance URL

- **Cloud**: `https://app.supercheck.io` (default)
- **Self-Hosted**: Your custom deployment URL (e.g., `https://check.yourcompany.com`)

### Recorder Settings

- **Default Language**: Choose the display language for recorded scripts
- **Test ID Attribute**: Custom attribute for `getByTestId()` selectors (default: `data-testid`)
- **Side Panel Mode**: Open recorder in side panel instead of popup

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift+Alt+R` | Start recording |
| `Shift+Alt+C` | Start inspecting |

## Security

- API keys are stored in Chrome sync storage; protect the browser profile and revoke a key if the profile or device is lost
- Keys are never logged or exposed after initial setup
- All communication uses HTTPS (except localhost for development)
- Recorded form input may appear in generated code, so review scripts and avoid recording real secrets

## Development

### Project Structure

```
examples/recorder-crx/
├── public/
│   └── manifest.json         # Extension manifest
├── src/
│   ├── background.ts         # Service worker
│   ├── content-script.ts     # Content script for web app bridge
│   ├── index.tsx             # Side panel entry
│   ├── options.tsx           # Options page
│   ├── settings.ts           # Settings storage & management
│   └── supercheck/           # Supercheck integration
│       ├── api-client.ts     # API client with retry logic
│       ├── config.ts         # Configuration management
│       ├── message-security.ts # Origin validation & security
│       └── index.ts          # Public module exports
├── options.html
├── index.html
└── package.json
```

### Building

Run build scripts from `examples/recorder-crx/` (or the repository root):

```bash
# Development build with watch
npm run dev

# Production build
npm run build

# Typecheck & lint
npm run lint
```

### Testing

End-to-end CRX browser tests are executed from the `recorder/` root directory:

```bash
cd supercheck/recorder

# Install browser test requirements
npm run test:install

# Run browser tests
npm test
```

## API Reference

### Message Types

The extension communicates with the Supercheck web app using `window.postMessage`:

| Message Type | Direction | Description |
|-------------|-----------|-------------|
| `SUPERCHECK_CHECK_EXTENSION` | App → Extension | Check if extension is installed |
| `SUPERCHECK_RECORDER_READY` | Extension → App | Extension announces its presence |
| `SUPERCHECK_START_RECORDING` | App → Extension | Request to start recording |
| `SUPERCHECK_AUTO_CONNECT` | App → Extension | Connect extension with credentials |
| `SUPERCHECK_RECORDING_COMPLETE` | Extension → App | Recording finished and saved |

### REST API Endpoints

The extension uses these Supercheck API endpoints:

- `GET /api/extension/projects` - List projects available to the extension user
- `POST /api/recordings` - Save recorded script as test
- `POST /api/auth/verify-key` - Verify API key validity
- `POST /api/extension/auth` - Generate extension API key

## License

Apache-2.0. The recorder derives from [Playwright CRX](https://github.com/ruifigueira/playwright-crx) and Microsoft Playwright; upstream notices are retained in the source tree.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for detailed guidelines.
