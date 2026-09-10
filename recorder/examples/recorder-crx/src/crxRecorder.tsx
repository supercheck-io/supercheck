/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import type { CallLog, ElementInfo, Mode, Source } from '@recorder/recorderTypes';
import { Recorder } from '@recorder/recorder';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings, removeSettingsChangedListener } from './settings';
import './crxRecorder.css';
import './form.css';

function setElementPicked(elementInfo: ElementInfo, userGesture?: boolean) {
  window.playwrightElementPicked(elementInfo, userGesture);
}

function setRunningFileId(fileId: string) {
  window.playwrightSetRunningFile(fileId);
}

interface RecordingContext {
  projectId?: string;
  testName?: string;
  returnUrl?: string;
  requirementId?: string;
  sourceTabId?: number;
}

export const CrxRecorder: React.FC = ({
}) => {
  const [, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [log, setLog] = React.useState(new Map<string, CallLog>());
  const [mode, setMode] = React.useState<Mode>('none');
  const [selectedFileId, setSelectedFileId] = React.useState<string>(defaultSettings.targetLanguage);
  const [recordingContext, setRecordingContext] = React.useState<RecordingContext | null>(null);
  const [savingToPlayground, setSavingToPlayground] = React.useState(false);
  const [toolbarPortal, setToolbarPortal] = React.useState<HTMLElement | null>(null);

  // Load recording context on mount and listen for changes
  // This ensures we capture the context even if it's set slightly after mount
  React.useEffect(() => {
    // Initial load
    const loadContext = () => {
      chrome.storage.session.get('recordingContext').then(result => {
        if (result.recordingContext)
          setRecordingContext(result.recordingContext);

      }).catch(() => {
        // Ignore errors
      });
    };

    loadContext();

    // Listen for storage changes (in case context is set after mount)
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'session' && changes.recordingContext) {
        if (changes.recordingContext.newValue)
          setRecordingContext(changes.recordingContext.newValue);

      }
    };

    chrome.storage.onChanged.addListener(storageListener);

    // Cleanup on unmount - this ensures context is cleared if user closes without saving
    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
      chrome.storage.session.remove('recordingContext').catch(() => { });
    };
  }, []);

  // Find toolbar and inject our button properly
  React.useEffect(() => {
    const findToolbar = () => {
      const toolbar = document.querySelector('.recorder .toolbar');
      if (!toolbar)
        return;

      // Aggressively hide Target-related elements
      // 1. Hide specific elements with 'Target' text
      Array.from(toolbar.children).forEach(child => {
        if (child.textContent?.includes('Target') || child.tagName === 'SELECT')
          (child as HTMLElement).style.display = 'none';

      });

      // 2. Hide text nodes containing "Target" (React often leaves these as raw text)
      toolbar.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Target'))
          node.textContent = ''; // Clear the text

      });

      // Find the first separator (usually after Record)
      const firstSeparator = toolbar.querySelector('.toolbar-separator');

      // Check if we already injected
      if (toolbar.querySelector('.save-btn-portal')) {
        setToolbarPortal(toolbar.querySelector('.save-btn-portal') as HTMLElement);
        return;
      }

      // Create portal container
      const portalContainer = document.createElement('div');
      portalContainer.className = 'save-btn-portal';
      // Inline flex to align perfectly
      portalContainer.style.display = 'inline-flex';
      portalContainer.style.alignItems = 'center';

      // Insert: If we have a separator, put us AFTER it.
      // Current: [Record] [Sep] ...
      // Desired: [Record] [Sep] [Save] [Sep] ...
      if (firstSeparator && firstSeparator.nextSibling) {
        toolbar.insertBefore(portalContainer, firstSeparator.nextSibling);
      } else {
        // Fallback: append to end
        toolbar.appendChild(portalContainer);
      }

      setToolbarPortal(portalContainer);
    };

    // Run repeatedly to catch re-renders
    const timer = setInterval(findToolbar, 100);
    setTimeout(() => clearInterval(timer), 2000); // Stop after 2s

    // Also observe DOM changes
    const observer = new MutationObserver(findToolbar);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearInterval(timer);
      observer.disconnect();
    };
  }, []);

  React.useEffect(() => {
    const port = chrome.runtime.connect({ name: 'recorder' });
    const onMessage = (msg: any) => {
      if (!('type' in msg) || msg.type !== 'recorder')
        return;

      switch (msg.method) {
        case 'setPaused': setPaused(msg.paused); break;
        case 'setMode': setMode(msg.mode); break;
        case 'setSources':
          // Customization: Only allow 'playwright-test' source to hide dropdown and enforce default
          setSources(msg.sources.filter((s: Source) => s.id === 'playwright-test'));
          break;
        case 'resetCallLogs': setLog(new Map()); break;
        case 'updateCallLogs': setLog(log => {
          const newLog = new Map<string, CallLog>(log);
          for (const callLog of msg.callLogs) {
            callLog.reveal = !log.has(callLog.id);
            newLog.set(callLog.id, callLog);
          }
          return newLog;
        }); break;
        case 'setRunningFile': setRunningFileId(msg.file); break;
        case 'elementPicked': setElementPicked(msg.elementInfo, msg.userGesture); break;
      }
    };
    port.onMessage.addListener(onMessage);

    window.dispatch = async (data: any) => {
      port.postMessage({ type: 'recorderEvent', ...data });
      if (data.event === 'fileChanged')
        setSelectedFileId(data.params.file);
    };
    loadSettings().then(settings => {
      setSettings(settings);
      // Force selected file to playwright-test
      setSelectedFileId('playwright-test');
    }).catch(() => { });

    addSettingsChangedListener(setSettings);

    return () => {
      removeSettingsChangedListener(setSettings);
      port.disconnect();
    };
  }, []);

  const source = React.useMemo(() => sources.find(s => s.id === selectedFileId), [sources, selectedFileId]);

  const dispatchEditedCode = React.useCallback((code: string) => {
    window.dispatch({ event: 'codeChanged', params: { code } });
  }, []);

  const dispatchCursorActivity = React.useCallback((position: { line: number }) => {
    window.dispatch({ event: 'cursorActivity', params: { position } });
  }, []);

  // Save recorded code back to Supercheck Playground
  const saveToPlayground = React.useCallback(async () => {
    if (!source?.text)
      return;

    setSavingToPlayground(true);
    try {
      // If we have a sourceTabId, send code back to the original tab
      if (recordingContext?.sourceTabId) {
        await chrome.runtime.sendMessage({
          type: 'INTERNAL_SEND_CODE_TO_PLAYGROUND',
          payload: { code: source.text }
        });
      }

      // Clear recording context so next recording starts fresh
      await chrome.storage.session.remove('recordingContext');
      setRecordingContext(null);

      // Stop recording mode first to ensure clean state
      window.dispatch({ event: 'setMode', params: { mode: 'none' } });

      // Small delay to ensure state is updated before closing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Close the recorder window after saving
      window.close();
    } catch (error) {
      console.error('[Supercheck] Failed to save to playground:', error);
      alert('Failed to save to playground. Please try again.');
    } finally {
      setSavingToPlayground(false);
    }
  }, [recordingContext, source]);

  // Save action link - styled exactly like the 'Record' text
  const isEnabled = !savingToPlayground && source?.text && recordingContext;

  const SaveButton = (
    <>
      <div
        className={`supercheck-save-link ${!isEnabled ? 'disabled' : ''}`}
        onClick={() => isEnabled && saveToPlayground()}
        title={recordingContext ? 'Save to Supercheck Playground' : 'Start recording from Supercheck to enable'}
      >
        <span className='codicon codicon-save' />
        <span>{savingToPlayground ? 'Saving...' : 'Save'}</span>
      </div>
      <div className='toolbar-separator'></div>
    </>
  );

  return <>
    <div className='recorder'>
      <Recorder sources={sources} paused={paused} log={log} mode={mode} onEditedCode={dispatchEditedCode} onCursorActivity={dispatchCursorActivity} />
      {/* Portal the Save button into the toolbar */}
      {toolbarPortal && ReactDOM.createPortal(SaveButton, toolbarPortal)}
    </div>
  </>;
};
