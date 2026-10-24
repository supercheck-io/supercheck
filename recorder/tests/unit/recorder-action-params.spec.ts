import { expect, test } from '@playwright/test';
import { traceParamsForAction } from '../../src/server/recorder/recorderUtils';
import type { Action } from '@recorder/actions';

const actions: Action[] = [
  { name: 'navigate', url: 'https://example.com', signals: [] },
  { name: 'click', selector: '#button', button: 'left', modifiers: 0, clickCount: 1, signals: [] },
  { name: 'press', selector: '#input', key: 'Enter', modifiers: 0, signals: [] },
  { name: 'fill', selector: '#input', text: 'text', signals: [] },
  { name: 'setInputFiles', selector: '#input', files: ['file.txt'], signals: [] },
  { name: 'check', selector: '#checkbox', signals: [] },
  { name: 'uncheck', selector: '#checkbox', signals: [] },
  { name: 'select', selector: '#select', options: ['value'], signals: [] },
];

for (const action of actions) {
  test(`${action.name} trace parameters include the recorder action deadline`, () => {
    const result = traceParamsForAction({
      action, frame: { pageAlias: 'page', framePath: [] }, startTime: 0,
    });
    expect(result.params.timeout).toBe(5_000);
    if ('selector' in action)
      expect(result.params.selector).toBe(action.selector);
    if (action.name === 'navigate')
      expect(result.params.url).toBe(action.url);
  });
}
