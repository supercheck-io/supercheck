/**
 * Supercheck Recorder - Save to Supercheck Button
 *
 * Button component for saving recorded scripts to Supercheck.
 */

import * as React from 'react';
import { apiClient, type Project, type RecordingMetadata } from '../api-client';
import { isConfigured } from '../config';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveToSupercheckProps {
  script: string;
  stepsCount: number;
  baseUrl: string;
  startTime: number;
  selectedProject: Project | null;
  onSaveComplete?: (testId: string, redirectUrl: string) => void;
  disabled?: boolean;
}

export function SaveToSupercheck({
  script,
  stepsCount,
  baseUrl,
  startTime,
  selectedProject,
  onSaveComplete,
  disabled,
}: SaveToSupercheckProps) {
  const [status, setStatus] = React.useState<SaveStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [testName, setTestName] = React.useState('');
  const [showNameInput, setShowNameInput] = React.useState(false);
  const [isConnected, setIsConnected] = React.useState(false);

  // Check connection status
  React.useEffect(() => {
    isConfigured().then(setIsConnected);
  }, []);

  // Generate default test name from URL
  React.useEffect(() => {
    if (baseUrl && !testName) {
      try {
        const url = new URL(baseUrl);
        const pathParts = url.pathname.split('/').filter(Boolean);
        const pageName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : url.hostname;
        setTestName(`Test ${pageName} ${new Date().toLocaleDateString()}`);
      } catch {
        setTestName(`Test ${new Date().toLocaleDateString()}`);
      }
    }
  }, [baseUrl, testName]);

  const handleSave = async () => {
    if (!selectedProject || !script || status === 'saving')
      return;

    // Show name input first time
    if (!showNameInput) {
      setShowNameInput(true);
      return;
    }

    setStatus('saving');
    setError(null);

    try {
      const metadata: RecordingMetadata = {
        recordedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
        stepsCount,
        baseUrl,
        browserInfo: navigator.userAgent,
        extensionVersion: chrome.runtime.getManifest().version,
      };

      const result = await apiClient.saveRecording({
        projectId: selectedProject.id,
        name: testName.trim() || `Recorded Test ${new Date().toLocaleDateString()}`,
        script,
        metadata,
      });

      setStatus('saved');
      onSaveComplete?.(result.testId, result.redirectUrl);

      // Open the test in Supercheck
      if (result.redirectUrl)
        chrome.tabs.create({ url: result.redirectUrl });

    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleOpenSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  if (!isConnected) {
    return (
      <div className='save-to-supercheck not-connected'>
        <button onClick={handleOpenSettings} className='connect-btn'>
          Connect to Supercheck
        </button>
      </div>
    );
  }

  if (showNameInput && status === 'idle') {
    return (
      <div className='save-to-supercheck name-input'>
        <input
          type='text'
          value={testName}
          onChange={e => setTestName(e.target.value)}
          placeholder='Enter test name'
          className='test-name-input'
          autoFocus
        />
        <div className='name-input-actions'>
          <button onClick={() => setShowNameInput(false)} className='cancel-btn'>
            Cancel
          </button>
          <button
            onClick={handleSave}
            className='save-btn primary'
            disabled={!testName.trim()}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='save-to-supercheck'>
      <button
        onClick={handleSave}
        disabled={disabled || !selectedProject || !script || status === 'saving' || status === 'saved'}
        className={`save-btn ${status}`}
        title={
          !selectedProject
            ? 'Select a project first'
            : !script
              ? 'Record some actions first'
              : 'Save to Supercheck'
        }
      >
        {status === 'idle' && (
          <>
            <SaveIcon />
            Save to Supercheck
          </>
        )}
        {status === 'saving' && (
          <>
            <SpinnerIcon />
            Saving...
          </>
        )}
        {status === 'saved' && (
          <>
            <CheckIcon />
            Saved!
          </>
        )}
        {status === 'error' && (
          <>
            <ErrorIcon />
            Retry
          </>
        )}
      </button>
      {error && <span className='save-error'>{error}</span>}
    </div>
  );
}

// Icon components
function SaveIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
      <path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' />
      <polyline points='17 21 17 13 7 13 7 21' />
      <polyline points='7 3 7 8 15 8' />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' className='spinner'>
      <circle cx='12' cy='12' r='10' strokeDasharray='32' strokeDashoffset='32'>
        <animate attributeName='stroke-dashoffset' dur='1s' values='32;0' repeatCount='indefinite' />
      </circle>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
      <polyline points='20 6 9 17 4 12' />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
      <circle cx='12' cy='12' r='10' />
      <line x1='15' y1='9' x2='9' y2='15' />
      <line x1='9' y1='9' x2='15' y2='15' />
    </svg>
  );
}
