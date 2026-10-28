/**
 * Supercheck Recorder - Options Page
 *
 * Connection model:
 * - Supercheck Cloud connects automatically after sign-in; nothing needs to be
 *   configured here. The URL field stays empty for it.
 * - Self-hosted deployments require the user to save their instance URL once.
 *   That explicit action is the trust decision for the origin.
 * - A recorder API key is only needed for advanced/manual setups. Keys are
 *   scoped to one instance, so switching the URL never reuses the old key.
 *
 * Settings page for configuring the extension, including:
 * - Supercheck instance URL (self-hosted)
 * - Optional recorder API key
 * - Recorder preferences
 */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  getConfig,
  replaceConfig,
  clearConfig,
  isSameInstance,
  validateInstanceUrl,
  DEFAULT_INSTANCE_URL,
  addConfigChangeListener,
  type SupercheckConfig
} from './supercheck/config';
import { apiClient } from './supercheck/api-client';
import { loadSettings, storeSettings, defaultSettings, type CrxSettings } from './settings';
import './options.css';

type ConnectionStatus = 'loading' | 'disconnected' | 'configured' | 'connecting' | 'connected' | 'error';

interface ConnectionState {
  status: ConnectionStatus;
  message?: string;
  email?: string;
}

const DOCS_URL = 'https://supercheck.io/docs/recorder';
const ISSUES_URL = 'https://github.com/supercheck-io/supercheck/issues';

/** The URL input stays empty for Supercheck Cloud so no address is shown. */
const customUrlFor = (url: string | undefined) => (!url || isSameInstance(url, DEFAULT_INSTANCE_URL) ? '' : url);

/**
 * Small "i" button that reveals a short explanation on hover or keyboard
 * focus. Keeps the form compact while the detail stays one click away.
 */
function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <span className='info-tip'>
      <button type='button' className='info-tip-button' aria-label={`About ${label}`} aria-describedby={id}>
        <svg viewBox='0 0 16 16' width='14' height='14' aria-hidden='true'>
          <circle cx='8' cy='8' r='7' fill='none' stroke='currentColor' strokeWidth='1.5' />
          <rect x='7.25' y='7' width='1.5' height='4.5' rx='0.75' fill='currentColor' />
          <circle cx='8' cy='4.75' r='0.9' fill='currentColor' />
        </svg>
      </button>
      <span role='tooltip' id={id} className='info-tip-body'>{children}</span>
    </span>
  );
}

function OptionsPage() {
  const [config, setConfig] = React.useState<SupercheckConfig | null>(null);
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [connectionState, setConnectionState] = React.useState<ConnectionState>({ status: 'loading' });
  const [customUrl, setCustomUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [hasStoredKey, setHasStoredKey] = React.useState(false);
  const [urlError, setUrlError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [showSelfHosted, setShowSelfHosted] = React.useState(false);
  const [showApiKey, setShowApiKey] = React.useState(false);

  // Empty means Supercheck Cloud.
  const instanceUrl = customUrl.trim() || DEFAULT_INSTANCE_URL;
  const instanceUrlRef = React.useRef(instanceUrl);
  instanceUrlRef.current = instanceUrl;
  const savedInstanceUrlRef = React.useRef<string | undefined>(undefined);
  savedInstanceUrlRef.current = config?.instanceUrl;
  // Set while the page itself writes storage so the change listener does not
  // replace the status message this page is about to show.
  const suppressStorageSyncRef = React.useRef(false);

  // storage.onChanged only fires when a value actually changes, so a no-op
  // write would leave the flag set and swallow the next real change.
  const releaseStorageSuppression = () => {
    window.setTimeout(() => {
      suppressStorageSyncRef.current = false;
    }, 500);
  };

  const describeFailure = React.useCallback((
    reason: string | undefined,
    retryAfterSeconds?: number
  ) => {
    switch (reason) {
      case 'rate_limited':
        return `Too many connection checks. Try again in ${retryAfterSeconds ?? 60} seconds.`;
      case 'unreachable':
        return 'Could not reach your Supercheck instance. Check the URL, then try again.';
      case 'server_error':
        return 'Your Supercheck instance returned an error. Try again in a moment.';
      case 'missing_key':
        return 'Enter a recorder API key, or sign in to Supercheck to connect automatically.';
      default:
        return 'That API key was rejected. Recorder keys only work with the instance that issued them.';
    }
  }, []);

  const applyConfig = React.useCallback((savedConfig: SupercheckConfig | null) => {
    setConfig(savedConfig);
    setHasStoredKey(Boolean(savedConfig?.apiKey));
  }, []);

  const verifySavedConnection = React.useCallback(async (savedConfig: SupercheckConfig) => {
    if (!savedConfig.apiKey) {
      setConnectionState({ status: 'disconnected' });
      return;
    }

    setConnectionState({ status: 'connecting' });
    const result = await apiClient.verifyConnection(savedConfig.apiKey, savedConfig.instanceUrl);
    if (result.valid) {
      setConnectionState({
        status: 'connected',
        email: result.user?.email ?? savedConfig.userEmail,
      });
      return;
    }

    setConnectionState({
      status: 'error',
      message: describeFailure(result.reason, result.retryAfterSeconds),
    });
  }, [describeFailure]);

  // Load initial config and settings.
  React.useEffect(() => {
    async function loadConfig() {
      const [savedConfig, savedSettings] = await Promise.all([
        getConfig(),
        loadSettings(),
      ]);

      applyConfig(savedConfig);
      const saved = customUrlFor(savedConfig.instanceUrl);
      setCustomUrl(saved);
      setShowSelfHosted(Boolean(saved));
      setSettings(savedSettings);
      await verifySavedConnection(savedConfig);
    }
    loadConfig();
  }, [applyConfig, verifySavedConnection]);

  // Reflect auto-connect (and disconnects) without requiring a reload.
  React.useEffect(() => {
    return addConfigChangeListener(changed => {
      const next = changed ?? {
        instanceUrl: DEFAULT_INSTANCE_URL,
        autoConnected: false,
      };
      const previousSavedUrl = savedInstanceUrlRef.current ?? DEFAULT_INSTANCE_URL;
      applyConfig(next);

      if (suppressStorageSyncRef.current) {
        suppressStorageSyncRef.current = false;
        return;
      }

      // An auto-connect from a Supercheck page is authoritative: it also
      // updates the instance this extension is paired with.
      if (next.apiKey) {
        setCustomUrl(customUrlFor(next.instanceUrl));
        setConnectionState({ status: 'connected', email: next.userEmail });
        setApiKey('');
        return;
      }

      // The credential is gone, so never keep showing "Connected". Only leave
      // the URL field alone when the user is mid-edit (it differs from what
      // was saved before this change).
      const userIsEditing = !isSameInstance(instanceUrlRef.current, previousSavedUrl);
      if (!userIsEditing)
        setCustomUrl(customUrlFor(next.instanceUrl));
      setConnectionState({ status: 'disconnected' });
    });
  }, [applyConfig]);

  // Validate URL on change.
  React.useEffect(() => {
    if (!customUrl.trim()) {
      setUrlError(null);
      return;
    }
    const validation = validateInstanceUrl(customUrl.trim());
    setUrlError(validation.valid ? null : validation.error || null);
  }, [customUrl]);

  const savedInstanceUrl = config?.instanceUrl ?? DEFAULT_INSTANCE_URL;
  const urlChanged = !isSameInstance(instanceUrl, savedInstanceUrl);
  const handleInstanceUrlChange = (next: string) => {
    setCustomUrl(next);
    setApiKey('');

    if (!isSameInstance(next.trim() || DEFAULT_INSTANCE_URL, savedInstanceUrl)) {
      setConnectionState({
        status: 'disconnected',
        message: hasStoredKey
          ? 'The saved credential belongs to the current instance and will be removed when you save this URL.'
          : undefined,
      });
      return;
    }

    // Back on the saved instance: re-check the stored key instead of assuming it still works.
    if (config?.apiKey)
      void verifySavedConnection(config);
  };

  const handleSaveInstance = async () => {
    const validation = validateInstanceUrl(instanceUrl);
    if (!validation.valid) {
      setUrlError(validation.error || 'Invalid URL');
      return;
    }

    setSaving(true);
    try {
      const changingInstance = !isSameInstance(instanceUrl, savedInstanceUrl);
      if (changingInstance) {
        // Dropping a credential that belongs to another instance is intentional:
        // it must never be sent to a host it was not created for.
        suppressStorageSyncRef.current = true;
        await replaceConfig({
          instanceUrl,
          autoConnected: false,
        });
        apiClient.clearCache();
        setConfig({ instanceUrl, autoConnected: false });
        setHasStoredKey(false);
        setApiKey('');
        setConnectionState({
          status: 'configured',
          message: 'URL saved. Sign in to your Supercheck instance to connect automatically.',
        });
      }

      await chrome.tabs.create({ url: instanceUrl });
    } catch (error) {
      suppressStorageSyncRef.current = false;
      setConnectionState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to save the instance URL',
      });
    } finally {
      releaseStorageSuppression();
      setSaving(false);
    }
  };

  const handleConnectWithKey = async () => {
    if (!apiKey.trim()) {
      setConnectionState({ status: 'error', message: 'Enter a recorder API key.' });
      return;
    }

    const validation = validateInstanceUrl(instanceUrl);
    if (!validation.valid) {
      setUrlError(validation.error || 'Invalid URL');
      return;
    }

    setSaving(true);
    setConnectionState({ status: 'connecting' });
    try {
      const result = await apiClient.verifyConnection(apiKey.trim(), instanceUrl);
      if (!result.valid) {
        setConnectionState({
          status: 'error',
          message: describeFailure(result.reason, result.retryAfterSeconds),
        });
        return;
      }

      suppressStorageSyncRef.current = true;
      await replaceConfig({
        instanceUrl,
        apiKey: apiKey.trim(),
        userEmail: result.user?.email,
        userId: result.user?.id,
        autoConnected: false,
      });
      apiClient.clearCache();
      setConfig({
        instanceUrl,
        apiKey: apiKey.trim(),
        userEmail: result.user?.email,
        userId: result.user?.id,
        autoConnected: false,
      });
      setHasStoredKey(true);
      setApiKey('');
      setConnectionState({ status: 'connected', email: result.user?.email });
    } catch (error) {
      suppressStorageSyncRef.current = false;
      setConnectionState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Connection failed',
      });
    } finally {
      releaseStorageSuppression();
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    try {
      suppressStorageSyncRef.current = true;
      const { revoked } = await clearConfig();
      apiClient.clearCache();
      setConfig(null);
      setHasStoredKey(false);
      setApiKey('');
      setCustomUrl('');
      setConnectionState({
        status: 'disconnected',
        message: revoked
          ? 'Disconnected. The recorder key was revoked on the server.'
          : 'Disconnected locally. The key could not be revoked on the server; remove it in Supercheck settings.',
      });
    } catch (error) {
      suppressStorageSyncRef.current = false;
      setConnectionState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Disconnect failed',
      });
    } finally {
      releaseStorageSuppression();
      setSaving(false);
    }
  };

  const handleSettingChange = async (key: keyof CrxSettings, value: string | boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await storeSettings(newSettings);
  };

  const statusLabel = (() => {
    switch (connectionState.status) {
      case 'loading':
        return 'Loading connection…';
      case 'connecting':
        return 'Checking connection…';
      case 'connected':
        return connectionState.email ? `Connected as ${connectionState.email}` : 'Connected';
      case 'configured':
        return connectionState.message;
      case 'error':
        return connectionState.message;
      default:
        return connectionState.message ?? 'Not connected';
    }
  })();

  const connected = connectionState.status === 'connected';
  const chevron = (open: boolean) => (
    <svg className={`chevron${open ? ' open' : ''}`} viewBox='0 0 16 16' width='14' height='14' aria-hidden='true'>
      <path d='M5 3l5 5-5 5' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );

  return (
    <div className='options-container'>
      <header className='options-header'>
        <h1>Supercheck Recorder</h1>
        <p className='subtitle'>Record a browser flow as a Playwright test, then open it in the Supercheck Playground.</p>
      </header>

      <main className='options-main'>
        <section className='options-section' aria-labelledby='connection-heading'>
          <h2 id='connection-heading'>Connection</h2>

          <div className='connection-status' role='status' aria-live='polite'>
            <span className={`status-indicator ${connectionState.status}`} />
            <span className='status-text'>{statusLabel}</span>
          </div>

          {connected ? (
            <div className='actions'>
              <button className='btn btn-secondary' onClick={handleDisconnect} disabled={saving}>
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <p className='lead'>
                Sign in to Supercheck in this browser and the recorder connects automatically.
              </p>
              <div className='actions'>
                <button
                  className='btn btn-primary'
                  onClick={handleSaveInstance}
                  disabled={saving || Boolean(urlError)}
                >
                  {saving ? 'Opening…' : 'Sign in to Supercheck'}
                </button>
              </div>

              <div className='disclosure'>
                <button
                  type='button'
                  className='disclosure-toggle'
                  onClick={() => setShowSelfHosted(value => !value)}
                  aria-expanded={showSelfHosted}
                  aria-controls='self-hosted-panel'
                >
                  {chevron(showSelfHosted)}
                  Self-hosted instance
                </button>
                {showSelfHosted && (
                  <div id='self-hosted-panel' className='disclosure-panel'>
                    <p className='hint'>
                      Only needed if you run your own Supercheck.{' '}
                      <a href={`${DOCS_URL}#self-hosted-supercheck`} target='_blank' rel='noopener noreferrer'>Setup guide</a>
                    </p>
                    <div className='form-group'>
                      <label htmlFor='instanceUrl'>Instance URL</label>
                      <input
                        id='instanceUrl'
                        type='url'
                        inputMode='url'
                        autoComplete='off'
                        spellCheck={false}
                        value={customUrl}
                        onChange={e => handleInstanceUrlChange(e.target.value)}
                        placeholder='Your Supercheck URL'
                        className={urlError ? 'error' : ''}
                        aria-invalid={Boolean(urlError)}
                        aria-describedby={urlError ? 'instanceUrl-error' : 'instanceUrl-hint'}
                      />
                      {urlError ? (
                        <span className='field-error' id='instanceUrl-error'>{urlError}</span>
                      ) : (
                        <span className='field-hint' id='instanceUrl-hint'>
                          Use the HTTPS address of your deployment. Saving it lets the recorder trust that site.
                        </span>
                      )}
                    </div>
                    <button
                      className='btn btn-secondary'
                      onClick={handleSaveInstance}
                      disabled={saving || !customUrl.trim() || Boolean(urlError)}
                    >
                      {saving ? 'Saving…' : urlChanged ? 'Save URL and sign in' : 'Open your instance'}
                    </button>
                  </div>
                )}
              </div>

              <div className='disclosure'>
                <button
                  type='button'
                  className='disclosure-toggle'
                  onClick={() => setShowApiKey(value => !value)}
                  aria-expanded={showApiKey}
                  aria-controls='api-key-panel'
                >
                  {chevron(showApiKey)}
                  Connect with an API key
                </button>
                {showApiKey && (
                  <div id='api-key-panel' className='disclosure-panel'>
                    <p className='hint'>
                      Only needed if you cannot sign in from this browser.{' '}
                      <a href={`${DOCS_URL}#manual-api-key-advanced`} target='_blank' rel='noopener noreferrer'>About API keys</a>
                    </p>
                    <div className='form-group'>
                      <label htmlFor='apiKey'>Recorder API key</label>
                      <input
                        id='apiKey'
                        type='password'
                        autoComplete='off'
                        spellCheck={false}
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        placeholder='Paste your recorder key'
                      />
                      <span className='field-hint'>
                        Keys only work with the instance that issued them. For a self-hosted instance, enter its URL first.
                      </span>
                    </div>
                    <button
                      className='btn btn-secondary'
                      onClick={handleConnectWithKey}
                      disabled={saving || !apiKey.trim() || Boolean(urlError)}
                    >
                      {saving ? 'Connecting…' : 'Connect'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <section className='options-section' aria-labelledby='recorder-heading'>
          <h2 id='recorder-heading'>Recorder</h2>

          <div className='form-group'>
            <label htmlFor='testIdAttributeName'>
              Test ID attribute
              <InfoTip label='the test ID attribute'>
                The HTML attribute your app uses for test hooks, such as data-testid or data-qa. Recorded
                selectors use getByTestId() when an element has it.
              </InfoTip>
            </label>
            <input
              id='testIdAttributeName'
              type='text'
              value={settings.testIdAttributeName}
              onChange={e => handleSettingChange('testIdAttributeName', e.target.value)}
              placeholder='data-testid'
            />
          </div>

          <div className='form-group checkbox-group'>
            <label>
              <input
                type='checkbox'
                checked={settings.sidepanel}
                onChange={e => handleSettingChange('sidepanel', e.target.checked)}
              />
              Open in side panel
            </label>
            <span className='field-hint'>Dock the recorder beside the page. Turn off to use a popup window.</span>
          </div>
        </section>
      </main>

      <footer className='options-footer'>
        <nav aria-label='Help'>
          <a href={DOCS_URL} target='_blank' rel='noopener noreferrer'>Documentation</a>
          <a href={ISSUES_URL} target='_blank' rel='noopener noreferrer'>Report an issue</a>
        </nav>
        <p>Version {chrome.runtime.getManifest().version}</p>
      </footer>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<OptionsPage />);
