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

#### Option 1: Seamless Connection (Recommended)

1. Log in to Supercheck in your browser
2. Go to Settings → Extensions
3. Click "Connect Recorder Extension"
4. The extension will be automatically configured

#### Option 2: Manual API Key

1. Click the extension icon and select "Options"
2. Enter your Supercheck instance URL
3. Enter your API key (from Supercheck → Settings → API Keys)
4. Click "Connect"

## Configuration

### Instance URL

- **Cloud**: `https://supercheck.io` (default)
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
| `Ctrl+S` | Save code (when experimental mode enabled) |

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
│   └── manifest.json       # Extension manifest
├── src/
│   ├── background.ts       # Service worker
│   ├── content-script.ts   # Content script for message bridge
│   ├── index.tsx           # Side panel entry
│   ├── options.tsx         # Options page
│   └── supercheck/         # Supercheck integration
│       ├── api-client.ts   # API client with retry logic
│       ├── config.ts       # Configuration management
│       ├── message-bridge.ts # Web app communication
│       └── components/     # React components
├── options.html
├── index.html
└── package.json
```

### Building

```bash
# Development build with watch
npm run dev

# Production build
npm run build
```

### Testing

```bash
# Run tests
npm test

# Run tests with UI
npm run test-ui
```

## API Reference

### Message Types

The extension communicates with the Supercheck web app using `window.postMessage`:

| Message Type | Direction | Description |
|-------------|-----------|-------------|
| `SUPERCHECK_CHECK_EXTENSION` | App → Extension | Check if extension is installed |
| `SUPERCHECK_RECORDER_READY` | Extension → App | Extension announces its presence |
| `SUPERCHECK_START_RECORDING` | App → Extension | Request to start recording |
| `SUPERCHECK_CONNECT_EXTENSION` | App → Extension | Connect extension with credentials |
| `SUPERCHECK_RECORDING_COMPLETE` | Extension → App | Recording finished and saved |

### REST API Endpoints

The extension uses these Supercheck API endpoints:

- `GET /api/projects` - List user's projects
- `POST /api/recordings` - Save recorded script as test
- `GET /api/auth/me` - Verify API key
- `POST /api/extension/auth` - Generate extension API key

## License

Apache-2.0. The recorder derives from [Playwright CRX](https://github.com/ruifigueira/playwright-crx) and Microsoft Playwright; upstream notices are retained in the source tree.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for detailed guidelines.
