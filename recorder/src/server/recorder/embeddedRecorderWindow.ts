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

import type { RecorderEventData, RecorderMessage, RecorderWindow } from './crxRecorderApp';

/**
 * EmbeddedRecorderWindow - Injects the recorder UI as an iframe into the target page
 * This approach doesn't require a user gesture like sidePanel.open() does
 */
export class EmbeddedRecorderWindow implements RecorderWindow {
  private _recorderUrl: string;
  private _tabId?: number;
  private _portPromise?: Promise<chrome.runtime.Port>;
  private _closed = true;
  onMessage?: (({ type, event, params }: RecorderEventData) => void) | undefined;
  hideApp?: (() => any) | undefined;

  constructor(recorderUrl?: string, tabId?: number) {
    this._recorderUrl = recorderUrl ?? 'index.html';
    this._tabId = tabId;
  }

  isClosed(): boolean {
    return this._closed;
  }

  postMessage(msg: RecorderMessage) {
    this._portPromise?.then(port => port.postMessage({ ...msg })).catch(() => {});
  }

  async open() {
    if (!this._tabId)
      throw new Error('Tab ID is required for embedded recorder');


    // Set up port connection listener
    this._portPromise = new Promise<chrome.runtime.Port>(resolve => {
      const onConnect = (port: chrome.runtime.Port) => {
        if (port.name !== 'recorder')
          return;
        chrome.runtime.onConnect.removeListener(onConnect);
        port.onDisconnect.addListener(this.close.bind(this));
        if (this.onMessage)
          port.onMessage.addListener(this.onMessage.bind(this));
        resolve(port);
      };
      chrome.runtime.onConnect.addListener(onConnect);
    });

    // Get the extension URLs for the iframe and logo
    const extensionUrl = chrome.runtime.getURL(this._recorderUrl);
    const logoUrl = chrome.runtime.getURL('supercheck-logo.png');

    // Inject the recorder iframe into the page
    await chrome.scripting.executeScript({
      target: { tabId: this._tabId },
      func: (iframeUrl: string, logoSrc: string) => {
        // Remove existing recorder container if present
        const existing = document.getElementById('supercheck-recorder-container');
        if (existing)
          existing.remove();

        // Create container for the split view
        const container = document.createElement('div');
        container.id = 'supercheck-recorder-container';
        container.style.cssText = `
          position: fixed !important;
          top: 0 !important;
          right: 0 !important;
          width: 420px !important;
          height: 100vh !important;
          z-index: 2147483647 !important;
          background: #1e1e2e !important;
          border-left: 2px solid #6366f1 !important;
          box-shadow: -4px 0 20px rgba(0,0,0,0.3) !important;
          display: flex !important;
          flex-direction: column !important;
        `;

        // Create header bar
        const header = document.createElement('div');
        header.style.cssText = `
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          padding: 8px 12px !important;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%) !important;
          color: white !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          cursor: default !important;
        `;
        header.innerHTML = `
          <span style="display: flex; align-items: center; gap: 8px;">
            <img src="${logoSrc}" alt="Supercheck" style="width: 20px; height: 20px; border-radius: 3px;" />
            Supercheck Recorder
          </span>
          <button id="supercheck-recorder-close" style="
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">✕</button>
        `;

        // Create iframe
        const iframe = document.createElement('iframe');
        iframe.id = 'supercheck-recorder-iframe';
        iframe.src = iframeUrl;
        iframe.style.cssText = `
          flex: 1 !important;
          width: 100% !important;
          border: none !important;
          background: #1e1e2e !important;
        `;
        iframe.allow = 'clipboard-read; clipboard-write';

        container.appendChild(header);
        container.appendChild(iframe);
        document.body.appendChild(container);

        // Shrink the page content to make room for recorder
        const originalBodyMargin = document.body.style.marginRight;
        document.body.style.marginRight = '420px';
        document.body.dataset.supercheckOriginalMargin = originalBodyMargin;

        // Handle close button
        const closeBtn = document.getElementById('supercheck-recorder-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            const containerEl = document.getElementById('supercheck-recorder-container');
            if (containerEl)
              containerEl.remove();
            document.body.style.marginRight = document.body.dataset.supercheckOriginalMargin || '';
            delete document.body.dataset.supercheckOriginalMargin;
            // Notify extension that recorder was closed
            window.postMessage({ type: 'SUPERCHECK_RECORDER_CLOSED' }, '*');
          });
        }
      },
      args: [extensionUrl, logoUrl]
    });

    // Wait for the iframe to connect
    await this._portPromise;
    this._closed = false;
  }

  async focus() {
    if (this._tabId)
      await chrome.tabs.update(this._tabId, { active: true });

  }

  async close() {
    if (this._closed)
      return;

    this._closed = true;

    // Remove the iframe from the page
    if (this._tabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: this._tabId },
          func: () => {
            const container = document.getElementById('supercheck-recorder-container');
            if (container)
              container.remove();
            document.body.style.marginRight = document.body.dataset.supercheckOriginalMargin || '';
            delete document.body.dataset.supercheckOriginalMargin;
          }
        });
      } catch (e) {
        // Tab might be closed already
      }
    }

    this._portPromise?.then(port => port.disconnect()).catch(() => {});
    this._portPromise = undefined;
    this.hideApp?.();
  }
}
