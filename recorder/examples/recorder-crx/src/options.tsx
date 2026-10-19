/**
 * Supercheck Recorder - Options Page
 *
 * Connection model:
 * - First-party Supercheck deployments (see SUPERCHECK_CLOUD_ORIGINS) connect
 *   automatically after sign-in; nothing needs to be configured here.
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
import { SUPERCHECK_CLOUD_ORIGINS } from './supercheck/message-security';
import { apiClient } from './supercheck/api-client';
import { loadSettings, storeSettings, defaultSettings, type CrxSettings } from './settings';
import './options.css';

type ConnectionStatus = 'loading' | 'disconnected' | 'configured' | 'connecting' | 'connected' | 'error';

interface ConnectionState {
  status: ConnectionStatus;
  message?: string;
  email?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function OptionsPage() {
  const [config, setConfig] = React.useState<SupercheckConfig | null>(null);
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [connectionState, setConnectionState] = React.useState<ConnectionState>({ status: 'loading' });
  const [instanceUrl, setInstanceUrl] = React.useState(DEFAULT_INSTANCE_URL);
  const [apiKey, setApiKey] = React.useState('');
  const [hasStoredKey, setHasStoredKey] = React.useState(false);
  const [urlError, setUrlError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const instanceUrlRef = React.useRef(instanceUrl);
  instanceUrlRef.current = instanceUrl;
  // Set while the page itself writes storage so the change listener does not
  // replace the status message this page is about to show.
  const suppressStorageSyncRef = React.useRef(false);

  const describeFailure = React.useCallback((
    reason: string | undefined,
    target: string,
    retryAfterSeconds?: number
  ) => {
    const host = hostOf(target);
    switch (reason) {
      case 'rate_limited':
        return `Too many connection checks. Try again in ${retryAfterSeconds ?? 60} seconds.`;
      case 'unreachable':
        return `Could not reach ${host}. Check the URL, then try again.`;
      case 'server_error':
        return `${host} returned an error. Try again in a moment.`;
      case 'missing_key':
        return 'Enter a recorder API key, or save the URL and sign in to connect automatically.';
      default:
        return `That API key was rejected by ${host}. Recorder keys are scoped to a single instance.`;
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
      message: describeFailure(result.reason, savedConfig.instanceUrl, result.retryAfterSeconds),
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
      setInstanceUrl(savedConfig.instanceUrl || DEFAULT_INSTANCE_URL);
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
      applyConfig(next);

      if (suppressStorageSyncRef.current) {
        suppressStorageSyncRef.current = false;
        return;
      }

      // An auto-connect from a Supercheck page is authoritative: it also
      // updates the instance this extension is paired with.
      if (next.apiKey) {
        setInstanceUrl(next.instanceUrl || DEFAULT_INSTANCE_URL);
        setConnectionState({ status: 'connected', email: next.userEmail });
        setApiKey('');
        return;
      }

      // Do not overwrite a URL the user is editing when a disconnect arrives.
      const userIsEditing = !isSameInstance(instanceUrlRef.current, next.instanceUrl);
      if (!userIsEditing) {
        setInstanceUrl(next.instanceUrl || DEFAULT_INSTANCE_URL);
        setConnectionState({ status: 'disconnected' });
      }
    });
  }, [applyConfig]);

  // Validate URL on change.
  React.useEffect(() => {
    if (!instanceUrl) {
      setUrlError('Instance URL is required');
      return;
    }
    const validation = validateInstanceUrl(instanceUrl);
    setUrlError(validation.valid ? null : validation.error || null);
  }, [instanceUrl]);

  const savedInstanceUrl = config?.instanceUrl ?? DEFAULT_INSTANCE_URL;
  const urlChanged = !isSameInstance(instanceUrl, savedInstanceUrl);
  const isCloudHost = React.useMemo(() => {
    try {
      return (SUPERCHECK_CLOUD_ORIGINS as readonly string[]).includes(new URL(instanceUrl).origin);
    } catch {
      return false;
    }
  }, [instanceUrl]);

  const handleInstanceUrlChange = (next: string) => {
    setInstanceUrl(next);
    setApiKey('');

    if (!isSameInstance(next, savedInstanceUrl)) {
      setConnectionState({
        status: 'disconnected',
        message: hasStoredKey
          ? `The saved credential belongs to ${hostOf(savedInstanceUrl)} and will be removed when you save this URL.`
          : undefined,
      });
      return;
    }

    if (config?.apiKey)
      setConnectionState({ status: 'connected', email: config.userEmail });
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
          message: isCloudHost
            ? `URL saved. Sign in to ${hostOf(instanceUrl)} to connect automatically.`
            : `Instance saved. Sign in to ${hostOf(instanceUrl)} to connect automatically.`,
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
          message: describeFailure(result.reason, instanceUrl, result.retryAfterSeconds),
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
        return `Connected to ${hostOf(savedInstanceUrl)}${connectionState.email ? ` as ${connectionState.email}` : ''}`;
      case 'configured':
        return connectionState.message;
      case 'error':
        return connectionState.message;
      default:
        return connectionState.message ?? 'Not connected';
    }
  })();

  return (
    <div className='options-container'>
      <header className='options-header'>
        <div className='logo-section'>
          <svg className='logo-icon' viewBox='0 0 32 32' width='32' height='32'>
            <circle cx='16' cy='16' r='16' fill='#50b748' />
            <path d='M13.52,23.383 L6.158,16.02l2.828-2.828l4.533,4.535l9.617-9.617l2.828,2.828L13.52,23.383z' fill='white' />
          </svg>
          <h1>Supercheck Recorder</h1>
        </div>
        <p className='subtitle'>Record browser interactions and save them as automated tests</p>
      </header>

      <main className='options-main'>
        {/* Connection Section */}
        <section className='options-section'>
          <h2>Supercheck Connection</h2>

          <div className='connection-status' role='status' aria-live='polite'>
            <span className={`status-indicator ${connectionState.status}`} />
            <span className='status-text'>{statusLabel}</span>
          </div>

          {connectionState.status === 'connected' ? (
            <div className='connection-actions'>
              <button
                className='btn btn-secondary'
                onClick={handleDisconnect}
                disabled={saving}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <div className='callout'>
                <strong>Supercheck-hosted sites connect automatically.</strong>
                <span>
                  {SUPERCHECK_CLOUD_ORIGINS.map(hostOf).join(', ')}
                </span>
                <span>
                  Only a self-hosted instance needs its URL saved here.
                </span>
              </div>

              <div className='form-group'>
                <label htmlFor='instanceUrl'>Supercheck instance URL</label>
                <input
                  id='instanceUrl'
                  type='url'
                  inputMode='url'
                  autoComplete='off'
                  spellCheck={false}
                  value={instanceUrl}
                  onChange={e => handleInstanceUrlChange(e.target.value)}
                  placeholder={DEFAULT_INSTANCE_URL}
                  className={urlError ? 'error' : ''}
                  aria-invalid={Boolean(urlError)}
                  aria-describedby='instanceUrl-hint'
                />
                {urlError && <span className='field-error'>{urlError}</span>}
                <span className='field-hint' id='instanceUrl-hint'>
                  Use the HTTPS URL of your deployment. Changing it clears the credential saved for the previous instance.
                </span>
              </div>

              <button
                className='btn btn-primary'
                onClick={handleSaveInstance}
                disabled={saving || !instanceUrl || Boolean(urlError)}
              >
                {saving ? 'Saving…' : urlChanged ? 'Save URL and open Supercheck' : 'Open Supercheck'}
              </button>

              <button
                type='button'
                className='btn-link'
                onClick={() => setShowAdvanced(value => !value)}
                aria-expanded={showAdvanced}
                aria-controls='advanced-connection'
              >
                {showAdvanced ? 'Hide advanced connection' : 'Advanced: connect with an API key'}
              </button>

              {showAdvanced && (
                <div id='advanced-connection' className='advanced-panel'>
                  <div className='form-group'>
                    <label htmlFor='apiKey'>Recorder API key</label>
                    <input
                      id='apiKey'
                      type='password'
                      autoComplete='off'
                      spellCheck={false}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder='Paste an existing recorder key'
                    />
                    <span className='field-hint'>
                      Optional. Use a recorder-scoped key from this instance when you cannot sign in here.
                      Keys are per instance; paste the key issued by {hostOf(instanceUrl)}.
                    </span>
                  </div>
                  <button
                    className='btn btn-secondary'
                    onClick={handleConnectWithKey}
                    disabled={saving || !apiKey.trim() || Boolean(urlError)}
                  >
                    {saving ? 'Connecting…' : 'Connect with API key'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Recorder Settings Section */}
        <section className='options-section'>
          <h2>Recorder Settings</h2>

          <div className='form-group'>
            <label htmlFor='testIdAttributeName'>Test ID Attribute</label>
            <input
              id='testIdAttributeName'
              type='text'
              value={settings.testIdAttributeName}
              onChange={e => handleSettingChange('testIdAttributeName', e.target.value)}
              placeholder='data-testid'
            />
            <span className='field-hint'>
              Attribute used for getByTestId() selectors
            </span>
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
            <span className='field-hint'>
              Open recorder in browser side panel instead of popup
            </span>
          </div>
        </section>

        {/* Help Section */}
        <section className='options-section help-section'>
          <h2>Need Help?</h2>
          <ul>
            <li>
              <a href='https://supercheck.io/docs/recorder' target='_blank' rel='noopener noreferrer'>
                Documentation
              </a>
            </li>
            <li>
              <a href='https://github.com/supercheck-io/supercheck/issues' target='_blank' rel='noopener noreferrer'>
                Report an Issue
              </a>
            </li>
            <li>
              <a href='https://supercheck.io' target='_blank' rel='noopener noreferrer'>
                Supercheck Website
              </a>
            </li>
          </ul>
        </section>
      </main>

      <footer className='options-footer'>
        <p>Supercheck Recorder v{chrome.runtime.getManifest().version}</p>
      </footer>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<OptionsPage />);
