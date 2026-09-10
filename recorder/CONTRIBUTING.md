# Contributing

Recorder contributions are accepted under Apache-2.0. Preserve existing third-party copyright headers and the attribution in `NOTICE`.

## Tests

We use Playwright to test Playwright CRX.

The `context` fixture is extended to load a Playwright CRX extension, such as the recorder or test extension.

### Run tests in extension service worker

To run tests in our `test-extension` just use `crxTest.ts` and use the `runCrxTest` with your test function.

It will run the function inside the extension:

```ts
import { test } from './crxTest';

test('should add todo item', async ({ runCrxTest }) => {
  await runCrxTest(async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc');

    await page.getByPlaceholder('What needs to be done?').fill('Hello world');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
  });
});
```

### Debug

Debugging an extension service worker requires opening its service worker devtools.

That can be done in `chrome://extensions` but to avoid lots of clicks and to allow test debugging, you can use the `Chrome DevTools` playwright project.

This project will open the extension devtools and set a `debugger` instruction for the debugger to pause before running the test.

That way, you can set all necessary breakpoints before continuing the execution.
