import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

const recorderRequire = createRequire(path.resolve(__dirname, '../../examples/recorder-crx/package.json'));

test('renders recorder React elements with its installed React DOM', () => {
  const React = recorderRequire('react');
  const { renderToStaticMarkup } = recorderRequire('react-dom/server');

  expect(renderToStaticMarkup(React.createElement('span', null, 'Recorder'))).toBe('<span>Recorder</span>');
});
