/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Mode } from '@recorder/recorderTypes';
import type { CrxApplication } from 'playwright-crx';
import playwright, { crx, _debug, _setUnderTest, _isUnderTest as isUnderTest } from 'playwright-crx';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings } from './settings';

type CrxMode = Mode | 'detached';

const stoppedModes: CrxMode[] = ['none', 'standby', 'detached'];
const recordingModes: CrxMode[] = ['recording', 'assertingText', 'assertingVisibility', 'assertingValue', 'assertingSnapshot'];

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;

const attachedTabIds = new Set<number>();
let currentMode: CrxMode | 'detached' | undefined;
let settings: CrxSettings = defaultSettings;
let isAttaching = false;

// if it's in sidepanel mode, we need to open it synchronously on action click,
// so we need to fetch its value asap
const settingsInitializing = loadSettings().then(s => settings = s).catch(() => {});

addSettingsChangedListener(newSettings => {
  settings = newSettings;
  setTestIdAttributeName(newSettings.testIdAttributeName);
});

let allowsIncognitoAccess = false;
chrome.extension.isAllowedIncognitoAccess().then(allowed => {
  allowsIncognitoAccess = allowed;
});

async function changeAction(tabId: number, mode?: CrxMode | 'detached') {
  if (!mode)
    mode = attachedTabIds.has(tabId) ? currentMode : 'detached';
  else if (mode !== 'detached')
    currentMode = mode;

  // detached basically implies recorder windows was closed
  if (!mode || stoppedModes.includes(mode)) {
    await Promise.all([
      chrome.action.setTitle({ title: mode === 'none' ? 'Stopped' : 'Record', tabId }),
      chrome.action.setBadgeText({ text: '', tabId }),
    ]).catch(() => {});
    return;
  }

  const { text, title, color, bgColor } = recordingModes.includes(mode) ?
    { text: 'REC', title: 'Recording', color: 'white', bgColor: 'darkred' } :
    { text: 'INS', title: 'Inspecting', color: 'white', bgColor: 'dodgerblue' };

  await Promise.all([
    chrome.action.setTitle({ title, tabId }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setBadgeTextColor({ color, tabId }),
    chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId }),
  ]).catch(() => {});
}

// action state per tab is reset every time a navigation occurs
// https://bugs.chromium.org/p/chromium/issues/detail?id=1450904
chrome.tabs.onUpdated.addListener(tabId => changeAction(tabId));

async function getCrxApp(incognito: boolean) {
  await settingsInitializing;

  // Check if there's an existing app we can use
  const existingApp = await crx.get({ incognito });

  if (existingApp) {
    if (!crxAppPromise)
      crxAppPromise = Promise.resolve(existingApp);

    return existingApp;
  }

  // Start a new app
  if (!crxAppPromise) {
    crxAppPromise = crx.start({ incognito }).then(crxApp => {
      // Close the crxApp on hide so next recording starts fresh
      crxApp.recorder.addListener('hide', async () => {
        // Reset side panel to empty.html to disconnect port for next recording
        try {
          await chrome.sidePanel.setOptions({ path: 'empty.html' });
        } catch {
          // Ignore errors
        }

        try {
          await crxApp.close();
        } catch {
          // May already be closed
        }
        // Clean up local state
        crxAppPromise = undefined;
        attachedTabIds.clear();
        currentMode = undefined;
        isAttaching = false;
        await chrome.storage.session.remove('recordingContext').catch(() => {});
      });

      crxApp.recorder.addListener('modechanged', async ({ mode }) => {
        await Promise.all([...attachedTabIds].map(tabId => changeAction(tabId, mode)));
      });
      crxApp.addListener('attached', async ({ tabId }) => {
        attachedTabIds.add(tabId);
        await changeAction(tabId, crxApp.recorder.mode());
      });
      crxApp.addListener('detached', async tabId => {
        attachedTabIds.delete(tabId);
        await changeAction(tabId, 'detached');
      });

      setTestIdAttributeName(settings.testIdAttributeName);
      return crxApp;
    }).catch(async error => {
      console.error('[Supercheck] Failed to start crxApp:', error);
      crxAppPromise = undefined;
      throw error;
    });
  }
  return await crxAppPromise;
}

async function attach(tab: chrome.tabs.Tab, mode?: Mode) {
  if (!tab?.id)
    return;

  // Prevent concurrent attach() calls
  if (isAttaching)
    return;

  isAttaching = true;

  // if the tab is incognito, check if can be started in incognito mode.
  if (tab.incognito && !allowsIncognitoAccess) {
    isAttaching = false;
    throw new Error('Not authorized to launch in Incognito mode.');
  }

  const sidepanel = !isUnderTest() && settings.sidepanel;

  // Open sidepanel IMMEDIATELY with user gesture
  if (sidepanel) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch {
      // May already be open
    }
  }

  // ensure one attachment at a time
  chrome.action.disable();

  try {
    // Check for pending recording context from Supercheck
    const { recordingContext } = await chrome.storage.session.get('recordingContext');
    let targetUrl = 'about:blank';

    if (recordingContext?.pendingStart) {
      await chrome.storage.session.set({
        recordingContext: { ...recordingContext, pendingStart: false }
      });
      if (recordingContext.targetUrl && recordingContext.targetUrl !== 'about:blank')
        targetUrl = recordingContext.targetUrl;

    }

    // Open a new tab for recording
    const currentWindow = await chrome.windows.getCurrent();
    const newTab = await chrome.tabs.create({
      url: targetUrl,
      windowId: currentWindow.id,
      active: true
    });

    if (newTab.id) {
      tab = { ...newTab, id: newTab.id } as chrome.tabs.Tab;
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Get crxApp
    const crxApp = await getCrxApp(tab.incognito);

    // Show the recorder
    const validMode = mode ?? 'recording';

    await crxApp.recorder.show({
      mode: validMode,
      language: settings.targetLanguage,
      window: { type: sidepanel ? 'sidepanel' : 'popup', url: 'index.html' },
      playInIncognito: settings.playInIncognito,
    });

    await crxApp.attach(tab.id!);

    if (mode)
      await crxApp.recorder.setMode(mode);
  } catch (error) {
    console.error('[Supercheck] Error in attach:', error);
    crxAppPromise = undefined;
    attachedTabIds.clear();
    currentMode = undefined;
  } finally {
    isAttaching = false;
    chrome.action.enable();
  }
}

async function setTestIdAttributeName(testIdAttributeName: string) {
  playwright.selectors.setTestIdAttribute(testIdAttributeName);
}

chrome.action.onClicked.addListener(attach);

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab.id)
    return;
  if (command === 'inspect')
    await attach(tab, 'inspecting');
  else if (command === 'record')
    await attach(tab, 'recording');
});

async function getStorageState() {
  const crxApp = await crxAppPromise;
  if (!crxApp)
    return;

  return await crxApp.context().storageState();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle PING from content script to verify connection
  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return true;
  }

  if (message.event === 'storageStateRequested') {
    getStorageState().then(sendResponse).catch(() => {});
    return true;
  }

  // Handle STORE_RECORDING_CONTEXT
  if (message.type === 'INTERNAL_STORE_RECORDING_CONTEXT') {
    const senderTabId = sender?.tab?.id;
    const recordingContext = {
      ...message.payload,
      sourceTabId: senderTabId,
      startedAt: Date.now(),
      pendingStart: true,
    };
    chrome.storage.session.set({ recordingContext }).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('[Supercheck] Failed to store recording context:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Handle CHECK_EXTENSION_STATUS
  if (message.type === 'INTERNAL_CHECK_EXTENSION_STATUS') {
    sendResponse({
      success: true,
      installed: true,
      version: chrome.runtime.getManifest().version
    });
    return true;
  }

  // Handle SEND_CODE_TO_PLAYGROUND
  if (message.type === 'INTERNAL_SEND_CODE_TO_PLAYGROUND') {
    sendCodeToPlayground(message.payload).then(() => {
      sendResponse({ success: true });
    }).catch((err: Error) => {
      console.error('[Supercheck] Failed to send code to playground:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // Handle AUTO_CONNECT from content script
  if (message.type === 'INTERNAL_AUTO_CONNECT') {
    chrome.storage.sync.set({
      supercheckConfig: { ...message.payload, autoConnected: true }
    }).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('[Supercheck] Failed to save config:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Handle DISCONNECT from content script
  if (message.type === 'INTERNAL_DISCONNECT') {
    chrome.storage.sync.remove('supercheckConfig').then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('[Supercheck] Failed to clear config:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});


/**
 * Send recorded code back to the source Playground tab
 */
async function sendCodeToPlayground(payload: { code: string }): Promise<void> {
  // Get the recording context to find the source tab
  const result = await chrome.storage.session.get('recordingContext');
  const context = result.recordingContext;

  if (!context?.sourceTabId)
    throw new Error('No source tab found - recording was not started from Supercheck');


  // Check if the tab still exists
  try {
    await chrome.tabs.get(context.sourceTabId);
  } catch {
    throw new Error('Source tab was closed');
  }

  // Send the code to the source tab's content script
  try {
    await chrome.tabs.sendMessage(context.sourceTabId, {
      type: 'SUPERCHECK_RECORDED_CODE',
      payload: {
        code: payload.code,
        projectId: context.projectId,
        requirementId: context.requirementId,
        testName: context.testName,
      }
    });
  } catch {
    // Fallback: Inject script to notify the page
    await chrome.storage.session.set({
      pendingRecordedCode: {
        code: payload.code,
        projectId: context.projectId,
        requirementId: context.requirementId,
        testName: context.testName,
      }
    });
    await chrome.scripting.executeScript({
      target: { tabId: context.sourceTabId },
      func: (data: unknown) => {
        window.postMessage({
          type: 'SUPERCHECK_RECORDED_CODE',
          payload: data,
          source: 'supercheck-recorder'
        }, window.location.origin);
      },
      args: [{
        code: payload.code,
        projectId: context.projectId,
        requirementId: context.requirementId,
        testName: context.testName,
      }]
    });
  }

  // Focus the source tab
  await chrome.tabs.update(context.sourceTabId, { active: true });

  // Clear the recording context
  await chrome.storage.session.remove('recordingContext');
}

chrome.runtime.onInstalled.addListener(details => {
  if ((globalThis as any).__crxTest)
    return;
  // Show welcome page on install only (not on update)
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL)
    chrome.tabs.create({ url: 'https://supercheck.io' }).catch(() => {});

});

// for testing
Object.assign(self, { attach, setTestIdAttributeName, getCrxApp, _debug, _setUnderTest });
