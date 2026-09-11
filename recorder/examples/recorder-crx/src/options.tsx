/**
 * Supercheck Recorder - Options Page
 *
 * Settings page for configuring the extension, including:
 * - Supercheck instance URL (for self-hosted)
 * - API Key management
 * - Recorder preferences
 */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  getConfig,
  saveConfig,
  clearConfig,
  validateInstanceUrl,
  DEFAULT_INSTANCE_URL,
  type SupercheckConfig
} from './supercheck/config';
import { apiClient } from './supercheck/api-client';
import { loadSettings, storeSettings, defaultSettings, type CrxSettings } from './settings';
import './options.css';

type ConnectionStatus = 'disconnected' | 'configured' | 'connecting' | 'connected' | 'error';

interface ConnectionState {
  status: ConnectionStatus;
  error?: string;
  user?: { email: string; name?: string };
}

function OptionsPage() {
  const [config, setConfig] = React.useState<SupercheckConfig | null>(null);
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [connectionState, setConnectionState] = React.useState<ConnectionState>({ status: 'disconnected' });
  const [instanceUrl, setInstanceUrl] = React.useState(DEFAULT_INSTANCE_URL);
  const [apiKey, setApiKey] = React.useState('');
  const [urlError, setUrlError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Load initial config
  React.useEffect(() => {
    async function loadConfig() {
      const [savedConfig, savedSettings] = await Promise.all([
        getConfig(),
        loadSettings(),
      ]);

      if (savedConfig) {
        setConfig(savedConfig);
        setInstanceUrl(savedConfig.instanceUrl || DEFAULT_INSTANCE_URL);
        setApiKey(savedConfig.apiKey || '');

        // Verify existing connection
        if (savedConfig.apiKey) {
          setConnectionState({ status: 'connecting' });
          try {
            const result = await apiClient.verifyConnection();
            if (result.valid) {
              setConnectionState({
                status: 'connected',
                user: result.user
                  ? { email: result.user.email, name: result.user.name }
                  : (savedConfig.userEmail ? { email: savedConfig.userEmail } : undefined),
              });
            } else {
              setConnectionState({ status: 'disconnected' });
            }
          } catch {
            setConnectionState({ status: 'error', error: 'Connection verification failed' });
          }
        }
      }

      setSettings(savedSettings);
    }
    loadConfig();
  }, []);

  // Validate URL on change
  React.useEffect(() => {
    if (instanceUrl) {
      const validation = validateInstanceUrl(instanceUrl);
      setUrlError(validation.valid ? null : validation.error || null);
    }
  }, [instanceUrl]);

  const handleConnect = async () => {
    if (!instanceUrl) {
      setConnectionState({ status: 'error', error: 'Instance URL is required' });
      return;
    }

    const validation = validateInstanceUrl(instanceUrl);
    if (!validation.valid) {
      setConnectionState({ status: 'error', error: validation.error });
      return;
    }

    setConnectionState({ status: 'connecting' });
    setSaving(true);

    try {
      if (!apiKey) {
        await saveConfig({ instanceUrl });
        apiClient.clearCache();
        await chrome.tabs.create({ url: instanceUrl });
        setConnectionState({
          status: 'configured',
          error: 'Instance saved. Sign in to Supercheck to connect automatically.'
        });
        return;
      }

      // Verify connection first before saving
      const result = await apiClient.verifyConnection(apiKey, instanceUrl);

      if (result.valid) {
        await saveConfig({
          instanceUrl,
          apiKey,
          userId: result.user?.id || config?.userId,
          userEmail: result.user?.email || config?.userEmail,
        });
        apiClient.clearCache();
        setConnectionState({
          status: 'connected',
          user: result.user
            ? { email: result.user.email, name: result.user.name }
            : (config?.userEmail ? { email: config.userEmail } : undefined),
        });
      } else {
        apiClient.clearCache();
        setConnectionState({ status: 'error', error: 'Invalid API key' });
      }
    } catch (error) {
      setConnectionState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Connection failed'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    try {
      await clearConfig();
      apiClient.clearCache();
      setConfig(null);
      setApiKey('');
      setConnectionState({ status: 'disconnected' });
    } finally {
      setSaving(false);
    }
  };

  const handleSettingChange = async (key: keyof CrxSettings, value: string | boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await storeSettings(newSettings);
  };

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

          <div className='connection-status'>
            <span className={`status-indicator ${connectionState.status}`} />
            <span className='status-text'>
              {connectionState.status === 'connected' && connectionState.user
                ? `Connected as ${connectionState.user.email}`
                : connectionState.status === 'connecting'
                  ? 'Connecting...'
                  : connectionState.status === 'configured'
                    ? connectionState.error
                    : connectionState.status === 'error'
                      ? connectionState.error
                      : 'Not connected'}
            </span>
          </div>

          {connectionState.status !== 'connected' && (
            <>
              <div className='form-group'>
                <label htmlFor='instanceUrl'>Supercheck Instance URL</label>
                <input
                  id='instanceUrl'
                  type='url'
                  value={instanceUrl}
                  onChange={e => setInstanceUrl(e.target.value)}
                  placeholder='https://app.supercheck.io'
                  className={urlError ? 'error' : ''}
                />
                {urlError && <span className='field-error'>{urlError}</span>}
                <span className='field-hint'>
                  Use https://app.supercheck.io for cloud, or your self-hosted URL
                </span>
              </div>

              <div className='form-group'>
                <label htmlFor='apiKey'>API Key</label>
                <input
                  id='apiKey'
                  type='password'
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder='Enter your API key'
                />
                <span className='field-hint'>
                  Optional: only use an existing recorder-scoped credential
                </span>
              </div>

              <button
                className='btn btn-primary'
                onClick={handleConnect}
                disabled={saving || !instanceUrl || !!urlError}
              >
                {saving ? 'Saving...' : apiKey ? 'Connect with API key' : 'Save URL and open Supercheck'}
              </button>
            </>
          )}

          {connectionState.status === 'connected' && (
            <button
              className='btn btn-secondary'
              onClick={handleDisconnect}
              disabled={saving}
            >
              Disconnect
            </button>
          )}
        </section>

        {/* Recorder Settings Section */}
        <section className='options-section'>
          <h2>Recorder Settings</h2>

          <div className='form-group'>
            <label htmlFor='targetLanguage'>Default Language</label>
            <select
              id='targetLanguage'
              value={settings.targetLanguage}
              onChange={e => handleSettingChange('targetLanguage', e.target.value)}
            >
              <option value='javascript'>JavaScript</option>
              <option value='playwright-test'>Playwright Test</option>
              <option value='python'>Python</option>
              <option value='python-pytest'>Python (pytest)</option>
              <option value='python-async'>Python (async)</option>
              <option value='java'>Java</option>
              <option value='java-junit'>Java (JUnit)</option>
              <option value='csharp'>C#</option>
              <option value='csharp-mstest'>C# (MSTest)</option>
              <option value='csharp-nunit'>C# (NUnit)</option>
            </select>
            <span className='field-hint'>
              Display language in recorder. Tests are saved as JavaScript.
            </span>
          </div>

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
              <a href='https://docs.supercheck.io/recorder' target='_blank' rel='noopener noreferrer'>
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
