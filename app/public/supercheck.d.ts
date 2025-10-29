/**
 * Professional TypeScript definitions for Supercheck Playground
 * Provides comprehensive type safety for test execution environment
 */

// === Complete Playwright Type Definitions ===

declare module "@playwright/test" {
  // --- Core Interfaces ---

  export interface Response {
    /** Gets the response status code. */
    status(): number;
    /** Checks if the response was successful (status in the 200-299 range). */
    ok(): boolean;
    /** Gets the response URL. */
    url(): string;
    /** Gets the response headers. */
    headers(): { [key: string]: string };
    /** Gets the response body as text. */
    text(): Promise<string>;
    /** Gets the response body as JSON. */
    json(): Promise<any>;
    /** Gets the response body as buffer. */
    body(): Promise<Buffer>;
  }

  export interface Locator {
    /** Clicks the element. */
    click(options?: { force?: boolean; timeout?: number; position?: { x: number; y: number }; modifiers?: string[]; button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number }): Promise<void>;
    /** Double-clicks the element. */
    dblclick(options?: { force?: boolean; timeout?: number; position?: { x: number; y: number }; modifiers?: string[]; button?: 'left' | 'right' | 'middle'; delay?: number }): Promise<void>;
    /** Fills the input element with text. */
    fill(value: string, options?: { force?: boolean; timeout?: number; noWaitAfter?: boolean }): Promise<void>;
    /** Types text into the element. */
    type(text: string, options?: { delay?: number; timeout?: number; noWaitAfter?: boolean }): Promise<void>;
    /** Presses a key on the element. */
    press(key: string, options?: { delay?: number; timeout?: number; noWaitAfter?: boolean }): Promise<void>;
    /** Hovers over the element. */
    hover(options?: { force?: boolean; timeout?: number; position?: { x: number; y: number }; modifiers?: string[]; noWaitAfter?: boolean }): Promise<void>;
    /** Focuses the element. */
    focus(options?: { timeout?: number }): Promise<void>;
    /** Checks the checkbox or radio button. */
    check(options?: { force?: boolean; timeout?: number; position?: { x: number; y: number }; noWaitAfter?: boolean }): Promise<void>;
    /** Unchecks the checkbox. */
    uncheck(options?: { force?: boolean; timeout?: number; position?: { x: number; y: number }; noWaitAfter?: boolean }): Promise<void>;
    /** Selects options in a <select> element. */
    selectOption(values: string | string[] | { label?: string; value?: string; index?: number } | { label?: string; value?: string; index?: number }[], options?: { force?: boolean; timeout?: number; noWaitAfter?: boolean }): Promise<string[]>;
    /** Drags and drops to another element. */
    dragTo(target: Locator, options?: { force?: boolean; timeout?: number; sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number }; noWaitAfter?: boolean }): Promise<void>;
    /** Gets the text content of the element. */
    textContent(options?: { timeout?: number }): Promise<string | null>;
    /** Gets the inner text of the element. */
    innerText(options?: { timeout?: number }): Promise<string>;
    /** Gets the innerHTML of the element. */
    innerHTML(options?: { timeout?: number }): Promise<string>;
    /** Gets the value of an input element. */
    inputValue(options?: { timeout?: number }): Promise<string>;
    /** Gets the value of an attribute. */
    getAttribute(name: string, options?: { timeout?: number }): Promise<string | null>;
    /** Checks if the element is visible. */
    isVisible(options?: { timeout?: number }): Promise<boolean>;
    /** Checks if the element is hidden. */
    isHidden(options?: { timeout?: number }): Promise<boolean>;
    /** Checks if the element is enabled. */
    isEnabled(options?: { timeout?: number }): Promise<boolean>;
    /** Checks if the element is disabled. */
    isDisabled(options?: { timeout?: number }): Promise<boolean>;
    /** Checks if the element is editable. */
    isEditable(options?: { timeout?: number }): Promise<boolean>;
    /** Checks if the element is checked. */
    isChecked(options?: { timeout?: number }): Promise<boolean>;
    /** Returns the first matching element. */
    first(): Locator;
    /** Returns the last matching element. */
    last(): Locator;
    /** Returns the nth matching element (0-based). */
    nth(index: number): Locator;
    /** Returns the number of elements matching the locator. */
    count(): Promise<number>;
    /** Returns a locator that matches the element's text content. */
    filter(options?: { hasText?: string | RegExp; has?: Locator; hasNot?: Locator; hasNotText?: string | RegExp }): Locator;
    /** Returns a locator that matches elements by role. */
    getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean; checked?: boolean; disabled?: boolean; expanded?: boolean; includeHidden?: boolean; level?: number; pressed?: boolean; selected?: boolean }): Locator;
    /** Returns a locator that matches the element's text content. */
    getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Returns a locator that matches the element's label text. */
    getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Returns a locator that matches the element's placeholder text. */
    getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Returns a locator that matches the element's alt text. */
    getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Returns a locator that matches the element's title attribute. */
    getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Returns a locator that matches the element's data-testid attribute. */
    getByTestId(testId: string | RegExp): Locator;
    /** Waits for the element to be in a specified state. */
    waitFor(options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>;
    /** Scrolls the element into view. */
    scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>;
    /** Highlights the element. */
    highlight(): Promise<void>;
    /** Evaluates JavaScript expression in the page context. */
    evaluate<R, Arg>(pageFunction: (element: Element, arg: Arg) => R | Promise<R>, arg?: Arg, options?: { timeout?: number }): Promise<R>;
    /** Returns all matching elements. */
    all(): Promise<Locator[]>;
  }

  export interface Page {
    /** Navigates to a URL. */
    goto(url: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; referer?: string }): Promise<Response | null>;
    /** Clicks an element matching the selector. */
    click(selector: string, options?: { force?: boolean; timeout?: number; position?: { x: number; y: number }; modifiers?: string[]; button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number; noWaitAfter?: boolean; strict?: boolean }): Promise<void>;
    /** Double-clicks an element matching the selector. */
    dblclick(selector: string, options?: { force?: boolean; timeout?: number; position?: { x: number; y: number }; modifiers?: string[]; button?: 'left' | 'right' | 'middle'; delay?: number; noWaitAfter?: boolean; strict?: boolean }): Promise<void>;
    /** Fills an input element matching the selector. */
    fill(selector: string, value: string, options?: { force?: boolean; timeout?: number; noWaitAfter?: boolean; strict?: boolean }): Promise<void>;
    /** Types text into an element matching the selector. */
    type(selector: string, text: string, options?: { delay?: number; timeout?: number; noWaitAfter?: boolean; strict?: boolean }): Promise<void>;
    /** Waits for a selector to appear in the DOM. */
    waitForSelector(selector: string, options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number; strict?: boolean }): Promise<Locator>;
    /** Waits for navigation to complete. */
    waitForNavigation(options?: { url?: string | RegExp; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<Response | null>;
    /** Waits for a specific response. */
    waitForResponse(urlOrPredicate: string | RegExp | ((response: Response) => boolean | Promise<boolean>), options?: { timeout?: number }): Promise<Response>;
    /** Waits for a specific request. */
    waitForRequest(urlOrPredicate: string | RegExp | ((request: Request) => boolean | Promise<boolean>), options?: { timeout?: number }): Promise<Request>;
    /** Waits for an event to be fired. */
    waitForEvent<T = any>(event: string, optionsOrPredicate?: { predicate?: (arg: T) => boolean | Promise<boolean>; timeout?: number } | ((arg: T) => boolean | Promise<boolean>)): Promise<T>;
    /** Waits for a function to return a truthy value. */
    waitForFunction<Arg>(pageFunction: (arg: Arg) => any, arg?: Arg, options?: { timeout?: number; polling?: number | 'raf' }): Promise<any>;
    /** Waits for the load state to be reached. */
    waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void>;
    /** Waits for a timeout. */
    waitForTimeout(timeout: number): Promise<void>;
    /** Evaluates a function in the page context. */
    evaluate<R, Arg>(pageFunction: (arg: Arg) => R | Promise<R>, arg?: Arg): Promise<R>;
    /** Returns a locator for the given selector. */
    locator(selector: string, options?: { hasText?: string | RegExp; has?: Locator }): Locator;
    /** Gets a locator by ARIA role. */
    getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean; checked?: boolean; disabled?: boolean; expanded?: boolean; includeHidden?: boolean; level?: number; pressed?: boolean; selected?: boolean }): Locator;
    /** Gets a locator by its text content. */
    getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its label text. */
    getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its placeholder text. */
    getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its alt text. */
    getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its title attribute. */
    getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its data-testid attribute. */
    getByTestId(testId: string | RegExp): Locator;
    /** Sets the viewport size. */
    setViewportSize(viewportSize: { width: number; height: number }): Promise<void>;
    /** Gets the viewport size. */
    viewportSize(): { width: number; height: number } | null;
    /** Closes the page. */
    close(options?: { runBeforeUnload?: boolean }): Promise<void>;
    /** Reloads the current page. */
    reload(options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<Response | null>;
    /** Returns the page's title. */
    title(): Promise<string>;
    /** Returns the page's URL. */
    url(): string;
    /** Returns the page's content. */
    content(): Promise<string>;
    /** Sets the page's content. */
    setContent(html: string, options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<void>;
    /** Adds a script tag into the page. */
    addScriptTag(options?: { url?: string; path?: string; content?: string; type?: string }): Promise<void>;
    /** Adds a style tag into the page. */
    addStyleTag(options?: { url?: string; path?: string; content?: string }): Promise<void>;
    /** Returns the page's main frame. */
    mainFrame(): Frame;
    /** Returns an array of all frames attached to the page. */
    frames(): Frame[];
    /** Returns a frame by name or URL. */
    frame(options: { name: string } | { url: string | RegExp }): Frame | null;
    /** Returns the keyboard object for the page. */
    keyboard: Keyboard;
    /** Returns the mouse object for the page. */
    mouse: Mouse;
    /** Returns the touchscreen object for the page. */
    touchscreen: Touchscreen;
    /** Returns the request object for API testing. */
    request: APIRequestContext;
    /** Adds a route handler. */
    route(url: string | RegExp | ((url: URL) => boolean), handler: (route: Route, request: Request) => void): Promise<void>;
    /** Removes a route handler. */
    unroute(url: string | RegExp | ((url: URL) => boolean), handler?: (route: Route, request: Request) => void): Promise<void>;
    /** Removes all route handlers. */
    unrouteAll(options?: { behavior?: 'wait' | 'ignoreErrors' | 'default' }): Promise<void>;
    /** Exposes a function to the page. */
    exposeFunction(name: string, callback: Function): Promise<void>;
    /** Exposes a binding to the page. */
    exposeBinding(name: string, callback: (source: { context: BrowserContext; page: Page; frame: Frame }, ...args: any[]) => any, options?: { handle?: boolean }): Promise<void>;
    /** Pauses script execution. */
    pause(): Promise<void>;
    /** Brings the page to front. */
    bringToFront(): Promise<void>;
    /** Emulates a media type. */
    emulateMedia(options?: { media?: 'screen' | 'print' | null; colorScheme?: 'light' | 'dark' | 'no-preference' | null; reducedMotion?: 'reduce' | 'no-preference' | null; forcedColors?: 'active' | 'none' | null }): Promise<void>;
    /** Sets geolocation. */
    setGeolocation(geolocation: { latitude: number; longitude: number; accuracy?: number } | null): Promise<void>;
    /** Sets extra HTTP headers. */
    setExtraHTTPHeaders(headers: { [key: string]: string }): Promise<void>;
  }

  export interface Request {
    /** Gets the request URL. */
    url(): string;
    /** Gets the request resource type. */
    resourceType(): string;
    /** Gets the request method. */
    method(): string;
    /** Gets the request post data. */
    postData(): string | null;
    /** Gets the request post data as buffer. */
    postDataBuffer(): Buffer | null;
    /** Gets the request post data as JSON. */
    postDataJSON(): any;
    /** Gets the request headers. */
    headers(): { [key: string]: string };
    /** Gets the response for this request. */
    response(): Promise<Response | null>;
    /** Gets the frame that initiated this request. */
    frame(): Frame;
    /** Checks if the request is a navigation request. */
    isNavigationRequest(): boolean;
    /** Gets the request that redirected to this request. */
    redirectedFrom(): Request | null;
    /** Gets the request that this request redirected to. */
    redirectedTo(): Request | null;
    /** Gets failure information if the request failed. */
    failure(): { errorText: string } | null;
    /** Gets timing information for the request. */
    timing(): ResourceTiming;
  }

  export interface Route {
    /** Continues the route's request. */
    continue(options?: { url?: string; method?: string; postData?: string | Buffer; headers?: { [key: string]: string } }): Promise<void>;
    /** Fulfills the route's request. */
    fulfill(options?: { status?: number; headers?: { [key: string]: string }; body?: string | Buffer; path?: string; contentType?: string; response?: Response }): Promise<void>;
    /** Aborts the route's request. */
    abort(errorCode?: string): Promise<void>;
    /** Gets the route's request. */
    request(): Request;
  }

  export interface ResourceTiming {
    startTime: number;
    domainLookupStart: number;
    domainLookupEnd: number;
    connectStart: number;
    secureConnectionStart: number;
    connectEnd: number;
    requestStart: number;
    responseStart: number;
    responseEnd: number;
  }

  export interface APIRequestContext {
    /** Creates a new APIRequestContext. */
    newContext(options?: { baseURL?: string; extraHTTPHeaders?: { [key: string]: string }; httpCredentials?: { username: string; password: string }; ignoreHTTPSErrors?: boolean; proxy?: { server: string; bypass?: string; username?: string; password?: string }; timeout?: number; userAgent?: string; storageState?: string | { cookies: any[]; origins: any[] } }): Promise<APIRequestContext>;
    /** Disposes the APIRequestContext. */
    dispose(): Promise<void>;
    /** Performs a DELETE request. */
    delete(url: string, options?: { data?: any; form?: { [key: string]: string | number | boolean }; headers?: { [key: string]: string }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; multipart?: { [key: string]: string | number | boolean | ReadStream | { name: string; mimeType: string; buffer: Buffer } }; params?: { [key: string]: string | number | boolean }; timeout?: number; failOnStatusCode?: boolean }): Promise<Response>;
    /** Performs a GET request. */
    get(url: string, options?: { headers?: { [key: string]: string }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; params?: { [key: string]: string | number | boolean }; timeout?: number; failOnStatusCode?: boolean }): Promise<Response>;
    /** Performs a HEAD request. */
    head(url: string, options?: { headers?: { [key: string]: string }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; params?: { [key: string]: string | number | boolean }; timeout?: number; failOnStatusCode?: boolean }): Promise<Response>;
    /** Performs a PATCH request. */
    patch(url: string, options?: { data?: any; form?: { [key: string]: string | number | boolean }; headers?: { [key: string]: string }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; multipart?: { [key: string]: string | number | boolean | ReadStream | { name: string; mimeType: string; buffer: Buffer } }; params?: { [key: string]: string | number | boolean }; timeout?: number; failOnStatusCode?: boolean }): Promise<Response>;
    /** Performs a POST request. */
    post(url: string, options?: { data?: any; form?: { [key: string]: string | number | boolean }; headers?: { [key: string]: string }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; multipart?: { [key: string]: string | number | boolean | ReadStream | { name: string; mimeType: string; buffer: Buffer } }; params?: { [key: string]: string | number | boolean }; timeout?: number; failOnStatusCode?: boolean }): Promise<Response>;
    /** Performs a PUT request. */
    put(url: string, options?: { data?: any; form?: { [key: string]: string | number | boolean }; headers?: { [key: string]: string }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; multipart?: { [key: string]: string | number | boolean | ReadStream | { name: string; mimeType: string; buffer: Buffer } }; params?: { [key: string]: string | number | boolean }; timeout?: number; failOnStatusCode?: boolean }): Promise<Response>;
    /** Gets storage state. */
    storageState(options?: { path?: string }): Promise<{ cookies: any[]; origins: any[] }>;
  }

  export interface Frame {
    /** Returns the frame's name. */
    name(): string;
    /** Returns the frame's URL. */
    url(): string;
    /** Returns the frame's parent frame, if any. */
    parentFrame(): Frame | null;
    /** Returns an array of child frames. */
    childFrames(): Frame[];
    /** Returns a locator for the given selector. */
    locator(selector: string, options?: { hasText?: string | RegExp; has?: Locator }): Locator;
    /** Gets a locator by ARIA role. */
    getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): Locator;
    /** Gets a locator by its text content. */
    getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its label text. */
    getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its placeholder text. */
    getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its alt text. */
    getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its title attribute. */
    getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
    /** Gets a locator by its data-testid attribute. */
    getByTestId(testId: string | RegExp): Locator;
    /** Waits for a selector. */
    waitForSelector(selector: string, options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number; strict?: boolean }): Promise<Locator>;
    /** Waits for a function to return truthy. */
    waitForFunction<Arg>(pageFunction: (arg: Arg) => any, arg?: Arg, options?: { timeout?: number; polling?: number | 'raf' }): Promise<any>;
    /** Evaluates JavaScript in the frame. */
    evaluate<R, Arg>(pageFunction: (arg: Arg) => R | Promise<R>, arg?: Arg): Promise<R>;
  }

  export interface Keyboard {
    /** Presses a key. */
    press(key: string, options?: { delay?: number }): Promise<void>;
    /** Types text. */
    type(text: string, options?: { delay?: number }): Promise<void>;
    /** Inserts a single character. */
    insertText(text: string): Promise<void>;
    /** Presses down a key. */
    down(key: string): Promise<void>;
    /** Releases a key. */
    up(key: string): Promise<void>;
  }

  export interface Mouse {
    /** Moves the mouse to a position. */
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    /** Clicks at the current mouse position. */
    click(x: number, y: number, options?: { delay?: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void>;
    /** Double-clicks at the current mouse position. */
    dblclick(x: number, y: number, options?: { delay?: number; button?: 'left' | 'right' | 'middle' }): Promise<void>;
    /** Presses down a mouse button. */
    down(options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void>;
    /** Releases a mouse button. */
    up(options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void>;
    /** Performs a mouse wheel action. */
    wheel(deltaX: number, deltaY: number): Promise<void>;
  }

  export interface Touchscreen {
    /** Taps at a position. */
    tap(x: number, y: number): Promise<void>;
  }

  export interface BrowserContext {
    /** Returns a new page in the context. */
    newPage(): Promise<Page>;
    /** Returns all pages in the context. */
    pages(): Page[];
    /** Closes the context and all pages in it. */
    close(): Promise<void>;
    /** Adds cookies to the context. */
    addCookies(cookies: Array<{ name: string; value: string; url?: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }>): Promise<void>;
    /** Gets all cookies. */
    cookies(urls?: string | string[]): Promise<Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }>>;
    /** Clears all cookies in the context. */
    clearCookies(): Promise<void>;
    /** Grants permissions to the context. */
    grantPermissions(permissions: string[], options?: { origin?: string }): Promise<void>;
    /** Clears all permissions in the context. */
    clearPermissions(): Promise<void>;
    /** Sets the context's geolocation. */
    setGeolocation(geolocation: { latitude: number; longitude: number; accuracy?: number } | null): Promise<void>;
    /** Sets the context's HTTP credentials. */
    setHTTPCredentials(credentials: { username: string; password: string } | null): Promise<void>;
    /** Sets the context's offline mode. */
    setOffline(offline: boolean): Promise<void>;
    /** Sets the context's extra HTTP headers. */
    setExtraHTTPHeaders(headers: { [key: string]: string }): Promise<void>;
    /** Gets storage state. */
    storageState(options?: { path?: string }): Promise<{ cookies: any[]; origins: any[] }>;
    /** Returns the request object for API testing. */
    request: APIRequestContext;
  }

  export interface Browser {
    /** Returns a new browser context. */
    newContext(options?: { viewport?: { width: number; height: number } | null; userAgent?: string; deviceScaleFactor?: number; isMobile?: boolean; hasTouch?: boolean; javaScriptEnabled?: boolean; timezoneId?: string; geolocation?: { latitude: number; longitude: number; accuracy?: number }; locale?: string; permissions?: string[]; extraHTTPHeaders?: { [key: string]: string }; offline?: boolean; httpCredentials?: { username: string; password: string }; ignoreHTTPSErrors?: boolean; bypassCSP?: boolean; colorScheme?: 'light' | 'dark' | 'no-preference' | null; reducedMotion?: 'reduce' | 'no-preference' | null; forcedColors?: 'active' | 'none' | null; acceptDownloads?: boolean; proxy?: { server: string; bypass?: string; username?: string; password?: string }; recordVideo?: { dir: string; size?: { width: number; height: number } } }): Promise<BrowserContext>;
    /** Returns all browser contexts. */
    contexts(): BrowserContext[];
    /** Closes the browser and all its contexts. */
    close(): Promise<void>;
    /** Gets the browser version. */
    version(): string;
  }

  // --- Test Fixtures ---
  export interface PlaywrightTestArgs {
    page: Page;
    context: BrowserContext;
    browser: Browser;
    browserName: string;
    request: APIRequestContext;
  }

  // --- Test Runner ---
  interface TestType {
    /** Declares a test. */
    (name: string, testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a test with additional details. */
    (name: string, details: { tag?: string | string[]; annotation?: { type: string; description?: string } }, testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a focused test. */
    only(name: string, testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a focused test with additional details. */
    only(name: string, details: { tag?: string | string[]; annotation?: { type: string; description?: string } }, testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a skipped test. */
    skip(name: string, testFn?: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a skipped test with additional details. */
    skip(name: string, details: { tag?: string | string[]; annotation?: { type: string; description?: string } }, testFn?: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a test that should be fixed. */
    fixme(name: string, testFn?: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a test that should be fixed with additional details. */
    fixme(name: string, details: { tag?: string | string[]; annotation?: { type: string; description?: string } }, testFn?: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a test that is expected to fail. */
    fail(name: string, testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Declares a test that is expected to fail with additional details. */
    fail(name: string, details: { tag?: string | string[]; annotation?: { type: string; description?: string } }, testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Groups tests together. */
    describe(name: string, testFn: () => void): void;
    /** Groups tests together with additional details. */
    describe(name: string, details: { tag?: string | string[]; annotation?: { type: string; description?: string } }, testFn: () => void): void;
    /** Groups tests together without a name. */
    describe(testFn: () => void): void;
    /** Runs before each test in a describe block. */
    beforeEach(testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Runs after each test in a describe block. */
    afterEach(testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Runs once before all tests in a describe block. */
    beforeAll(testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Runs once after all tests in a describe block. */
    afterAll(testFn: (fixtures: PlaywrightTestArgs) => Promise<void> | void): void;
    /** Configures the test. */
    configure(options: { mode?: 'default' | 'parallel' | 'serial'; retries?: number; timeout?: number; tag?: string | string[]; annotation?: { type: string; description?: string } }): void;
    /** Sets up fixtures for tests. */
    use(options: Partial<PlaywrightTestArgs>): void;
  }

  export const test: TestType;

  // --- Expect Matchers ---
  interface ExpectMatchers<R = Promise<void>> {
    /** Asserts the element is visible. */
    toBeVisible(options?: { timeout?: number }): R;
    /** Asserts the element is hidden. */
    toBeHidden(options?: { timeout?: number }): R;
    /** Asserts the element is enabled. */
    toBeEnabled(options?: { timeout?: number }): R;
    /** Asserts the element is disabled. */
    toBeDisabled(options?: { timeout?: number }): R;
    /** Asserts the element is editable. */
    toBeEditable(options?: { timeout?: number }): R;
    /** Asserts the element is checked. */
    toBeChecked(options?: { timeout?: number }): R;
    /** Asserts the element is focused. */
    toBeFocused(options?: { timeout?: number }): R;
    /** Asserts the element has the expected text content. */
    toHaveText(expected: string | RegExp | (string | RegExp)[], options?: { timeout?: number; useInnerText?: boolean; ignoreCase?: boolean }): R;
    /** Asserts the input element has the expected value. */
    toHaveValue(expected: string | RegExp, options?: { timeout?: number }): R;
    /** Asserts the element has the expected attribute value. */
    toHaveAttribute(name: string, expected?: string | RegExp, options?: { timeout?: number }): R;
    /** Asserts the element has the expected CSS class. */
    toHaveClass(expected: string | RegExp | (string | RegExp)[], options?: { timeout?: number }): R;
    /** Asserts the element has the expected CSS property. */
    toHaveCSS(name: string, expected: string | RegExp, options?: { timeout?: number }): R;
    /** Asserts the locator resolves to the expected number of elements. */
    toHaveCount(expected: number, options?: { timeout?: number }): R;
    /** Asserts the element has the expected ID. */
    toHaveId(expected: string | RegExp, options?: { timeout?: number }): R;
    /** Asserts the input element has the expected JavaScript property. */
    toHaveJSProperty(name: string, expected: any, options?: { timeout?: number }): R;
    /** Asserts the page has the expected title. */
    toHaveTitle(expected: string | RegExp, options?: { timeout?: number }): R;
    /** Asserts the page has the expected URL. */
    toHaveURL(expected: string | RegExp, options?: { timeout?: number }): R;
    /** Asserts the locator contains the expected element. */
    toContainText(expected: string | RegExp | (string | RegExp)[], options?: { timeout?: number; useInnerText?: boolean; ignoreCase?: boolean }): R;
    /** Asserts the value is equal to the expected value (deep equality). */
    toEqual(expected: any): R;
    /** Asserts the value is strictly equal to the expected value. */
    toBe(expected: any): R;
    /** Asserts the value is truthy. */
    toBeTruthy(): R;
    /** Asserts the value is falsy. */
    toBeFalsy(): R;
    /** Asserts the value is null. */
    toBeNull(): R;
    /** Asserts the value is defined. */
    toBeDefined(): R;
    /** Asserts the value is undefined. */
    toBeUndefined(): R;
    /** Asserts the value is NaN. */
    toBeNaN(): R;
    /** Asserts the value is greater than the expected value. */
    toBeGreaterThan(expected: number | bigint): R;
    /** Asserts the value is greater than or equal to the expected value. */
    toBeGreaterThanOrEqual(expected: number | bigint): R;
    /** Asserts the value is less than the expected value. */
    toBeLessThan(expected: number | bigint): R;
    /** Asserts the value is less than or equal to the expected value. */
    toBeLessThanOrEqual(expected: number | bigint): R;
    /** Asserts the value matches the expected regular expression. */
    toMatch(expected: string | RegExp): R;
    /** Asserts the value contains the expected substring. */
    toContain(expected: any): R;
    /** Asserts the value has the expected length. */
    toHaveLength(expected: number): R;
    /** Asserts the value is an instance of the expected class. */
    toBeInstanceOf(expected: Function): R;
    /** Asserts the value has the expected property. */
    toHaveProperty(keyPath: string | string[], value?: any): R;
    /** Asserts the value is close to the expected value. */
    toBeCloseTo(expected: number, numDigits?: number): R;
    /** Asserts the value matches the expected snapshot. */
    toMatchSnapshot(name?: string | string[], options?: { threshold?: number; maxDiffPixels?: number; maxDiffPixelRatio?: number; timeout?: number }): R;
    /** Asserts the function passes within the given timeout. */
    toPass(options?: { timeout?: number; intervals?: number[] }): R;
  }

  interface Expect {
    /** Creates an expectation for a locator or value. */
    <T = unknown>(actual: T): ExpectMatchers<Promise<void>>;
    /** Creates a soft expectation. */
    soft<T = unknown>(actual: T): ExpectMatchers<Promise<void>>;
    /** Polls the function until it returns a truthy value or times out. */
    poll<T>(fn: () => T | Promise<T>, options?: { timeout?: number; intervals?: number[] }): ExpectMatchers<Promise<void>>;
  }

  export const expect: Expect;
}

// Buffer type for screenshots and file handling
declare type Buffer = any;
declare type ReadStream = any;

// === Supercheck Global Functions ===

/**
 * Protected secret value that prevents accidental exposure while maintaining functionality.
 * 
 * This interface ensures that sensitive values cannot be accidentally logged, serialized,
 * or exposed through common inspection methods, while still working seamlessly with
 * Playwright methods and other APIs that require the actual secret value.
 * 
 * @example
 * ```typescript
 * const token = getSecret('API_TOKEN');
 * console.log(token);              // Outputs: "[SECRET]"
 * String(token);                   // Returns: "[SECRET]"
 * JSON.stringify({token});         // {"token":"[SECRET]"}
 * 
 * // But works perfectly for actual usage:
 * await page.setExtraHTTPHeaders({
 *   'Authorization': `Bearer ${token}` // Uses actual token value
 * });
 * ```
 */
interface ProtectedSecret {
  /** Returns the actual secret value for operations and type coercion */
  valueOf(): string;
  /** Returns "[SECRET]" to prevent console logging */
  toString(): string;
  /** Returns "[SECRET]" to prevent JSON serialization */
  toJSON(): string;
  /** Symbol.toPrimitive implementation for safe type coercion */
  [Symbol.toPrimitive](hint: 'string' | 'number' | 'default'): string | number;
  /** Prevents Node.js util.inspect from showing the actual value */
  [Symbol.for('nodejs.util.inspect.custom')](): string;
}

/**
 * Configuration options for variable and secret retrieval functions.
 * 
 * @template T - The expected type of the default value
 */
interface VariableOptions<T = any> {
  /** 
   * Default value to return if the variable is not defined.
   * The type of this value determines the return type when no explicit type is specified.
   */
  default?: T;
  
  /** 
   * Whether the variable is required. If true, throws an error when the variable is not found.
   * @default false
   */
  required?: boolean;
  
  /** 
   * Explicit type conversion for the variable value.
   * - 'string': Returns the value as a string
   * - 'number': Parses the value as a number (throws if invalid)
   * - 'boolean': Converts to boolean ('true'/'1' → true, others → false)
   */
  type?: 'string' | 'number' | 'boolean';
}

/**
 * Retrieves a project variable value with comprehensive type safety and validation.
 * 
 * Project variables are stored in plain text and are suitable for non-sensitive
 * configuration values such as URLs, timeouts, environment names, and public settings.
 * These values can be safely logged and are visible in test outputs.
 * 
 * @param key - The variable key name as defined in project settings
 * @param options - Configuration options for retrieval and type conversion
 * @returns The variable value with appropriate type conversion applied
 * 
 * @throws {Error} When `options.required` is true and the variable is not defined
 * @throws {Error} When type conversion fails (e.g., invalid number format)
 * 
 * @example Basic usage with string return type
 * ```typescript
 * const baseUrl = getVariable('BASE_URL');
 * const environment = getVariable('ENV', { default: 'development' });
 * ```
 * 
 * @example Type conversion with validation
 * ```typescript
 * const timeout = getVariable('TIMEOUT', { 
 *   type: 'number', 
 *   default: 5000 
 * });
 * const debugMode = getVariable('DEBUG_MODE', { 
 *   type: 'boolean', 
 *   default: false 
 * });
 * ```
 * 
 * @example Required variables with error handling
 * ```typescript
 * try {
 *   const apiUrl = getVariable('API_URL', { required: true });
 *   await page.goto(apiUrl);
 * } catch (error) {
 *   throw new Error(`Missing required variable: ${error.message}`);
 * }
 * ```
 * 
 * @see {@link getSecret} For sensitive values like passwords and API keys
 */
declare function getVariable<T = string>(
  key: string,
  options?: VariableOptions<T>
): T extends number ? number : T extends boolean ? boolean : string;

/**
 * Retrieves a project secret value with enterprise-grade security protection.
 * 
 * Project secrets are encrypted at rest using AES-128 encryption and are designed
 * for sensitive values such as passwords, API keys, tokens, and database credentials.
 * The returned value is protected from accidental exposure through logging, serialization,
 * and inspection while maintaining full compatibility with APIs that require the actual value.
 * 
 * @param key - The secret key name as defined in project settings
 * @param options - Configuration options for retrieval and type conversion
 * @returns A protected secret object (default) or typed value when `options.type` is specified
 * 
 * @throws {Error} When `options.required` is true and the secret is not defined
 * @throws {Error} When type conversion fails (e.g., invalid number format)
 * @throws {Error} When decryption fails due to invalid encryption key or corrupted data
 * 
 * @example Basic usage with ProtectedSecret (recommended)
 * ```typescript
 * const password = getSecret('USER_PASSWORD');
 * const apiToken = getSecret('API_TOKEN');
 * 
 * // Safe for logging - will show "[SECRET]" instead of actual value
 * console.log(`Using token: ${apiToken}`);
 * 
 * // Works seamlessly with Playwright and other APIs
 * await page.fill('#password', password);
 * await page.setExtraHTTPHeaders({
 *   'Authorization': `Bearer ${apiToken}`
 * });
 * ```
 * 
 * @example Explicit type conversion (returns actual value)
 * ```typescript
 * const apiKey = getSecret('API_KEY', { type: 'string' });
 * const dbPort = getSecret('DB_PORT', { type: 'number' });
 * const sslEnabled = getSecret('SSL_ENABLED', { type: 'boolean' });
 * 
 * // These return actual typed values, not ProtectedSecret objects
 * console.log(typeof apiKey);    // "string"
 * console.log(typeof dbPort);    // "number"
 * console.log(typeof sslEnabled); // "boolean"
 * ```
 * 
 * @example Error handling and fallbacks
 * ```typescript
 * const dbPassword = getSecret('DB_PASSWORD', {
 *   required: true,
 *   default: 'fallback-password' // Not recommended for production
 * });
 * 
 * try {
 *   const token = getSecret('OPTIONAL_TOKEN');
 *   if (token.valueOf()) {
 *     // Token exists, use it
 *   }
 * } catch (error) {
 *   console.error('Failed to retrieve secret:', error.message);
 * }
 * ```
 * 
 * @security
 * - Secrets are encrypted using AES-128-GCM with project-specific context
 * - Protected from console.log(), JSON.stringify(), and util.inspect()
 * - Returns "[SECRET]" for any string coercion or inspection
 * - Actual values only accessible through valueOf() or direct API usage
 * - No secret values are ever stored in browser memory unencrypted
 * 
 * @see {@link getVariable} For non-sensitive configuration values
 * @see {@link ProtectedSecret} For details on the protection mechanism
 */
declare function getSecret<T = ProtectedSecret>(
  key: string,
  options?: VariableOptions<T>
): T extends 'string' ? string 
  : T extends 'number' ? number 
  : T extends 'boolean' ? boolean 
  : ProtectedSecret;

// === Enhanced JavaScript Built-ins ===

/**
 * Enhanced console object with proper typing
 */
declare const console: {
  /** Outputs a message to the console */
  log(...data: any[]): void;
  /** Outputs an error message to the console */
  error(...data: any[]): void;
  /** Outputs a warning message to the console */
  warn(...data: any[]): void;
  /** Outputs an informational message to the console */
  info(...data: any[]): void;
  /** Outputs a debug message to the console */
  debug(...data: any[]): void;
  /** Creates a new inline group in the console */
  group(label?: string): void;
  /** Creates a new collapsed inline group in the console */
  groupCollapsed(label?: string): void;
  /** Exits the current inline group in the console */
  groupEnd(): void;
  /** Starts a timer with a name */
  time(label?: string): void;
  /** Stops a timer and outputs the elapsed time */
  timeEnd(label?: string): void;
  /** Displays data as a table */
  table(data: any, columns?: string[]): void;
  /** Clears the console */
  clear(): void;
  /** Outputs the number of times count() has been called */
  count(label?: string): void;
  /** Resets the count for a specific label */
  countReset(label?: string): void;
};

/**
 * Enhanced JSON object with better typing
 */
declare const JSON: {
  /** Parses a JSON string and returns the parsed value */
  parse<T = any>(text: string, reviver?: (key: string, value: any) => any): T;
  /** Converts a value to a JSON string */
  stringify(
    value: any,
    replacer?: (key: string, value: any) => any | (string | number)[] | null,
    space?: string | number
  ): string;
};

/**
 * Enhanced Math object for calculations in tests
 */
declare const Math: {
  /** Euler's constant and the base of natural logarithms */
  readonly E: number;
  /** Natural logarithm of 10 */
  readonly LN10: number;
  /** Natural logarithm of 2 */
  readonly LN2: number;
  /** Base 2 logarithm of E */
  readonly LOG2E: number;
  /** Base 10 logarithm of E */
  readonly LOG10E: number;
  /** Ratio of the circumference of a circle to its diameter */
  readonly PI: number;
  /** Square root of 1/2 */
  readonly SQRT1_2: number;
  /** Square root of 2 */
  readonly SQRT2: number;
  /** Returns the absolute value of a number */
  abs(x: number): number;
  /** Returns the arc cosine (in radians) of a number */
  acos(x: number): number;
  /** Returns the arc sine (in radians) of a number */
  asin(x: number): number;
  /** Returns the arc tangent (in radians) of a number */
  atan(x: number): number;
  /** Returns the arc tangent of the quotient of its arguments */
  atan2(y: number, x: number): number;
  /** Returns the smallest integer greater than or equal to a number */
  ceil(x: number): number;
  /** Returns the cosine of a number */
  cos(x: number): number;
  /** Returns e^x */
  exp(x: number): number;
  /** Returns the largest integer less than or equal to a number */
  floor(x: number): number;
  /** Returns the natural logarithm of a number */
  log(x: number): number;
  /** Returns the largest of zero or more numbers */
  max(...values: number[]): number;
  /** Returns the smallest of zero or more numbers */
  min(...values: number[]): number;
  /** Returns the value of a number raised to the power of another number */
  pow(x: number, y: number): number;
  /** Returns a pseudorandom number between 0 and 1 */
  random(): number;
  /** Returns the value of a number rounded to the nearest integer */
  round(x: number): number;
  /** Returns the sine of a number */
  sin(x: number): number;
  /** Returns the square root of a number */
  sqrt(x: number): number;
  /** Returns the tangent of a number */
  tan(x: number): number;
  /** Truncates the decimal part of a number */
  trunc(x: number): number;
};

// === Async Utilities ===

/**
 * Executes a function after a specified delay
 * @param callback Function to execute
 * @param ms Delay in milliseconds
 * @returns Timer ID that can be used with clearTimeout
 */
declare function setTimeout(callback: () => void, ms: number): number;

/**
 * Executes a function repeatedly with a fixed time delay
 * @param callback Function to execute
 * @param ms Interval in milliseconds
 * @returns Timer ID that can be used with clearInterval
 */
declare function setInterval(callback: () => void, ms: number): number;

/**
 * Cancels a timeout previously established by calling setTimeout
 * @param id Timer ID returned by setTimeout
 */
declare function clearTimeout(id: number): void;

/**
 * Cancels an interval previously established by calling setInterval
 * @param id Timer ID returned by setInterval
 */
declare function clearInterval(id: number): void;

// === Enhanced Date Object ===

/**
 * Enhanced Date constructor and static methods
 */
declare const Date: {
  new(): Date;
  new(value: number | string): Date;
  new(year: number, month: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): Date;
  /** Returns the current time in milliseconds since January 1, 1970 UTC */
  now(): number;
  /** Parses a date string and returns the number of milliseconds since January 1, 1970 UTC */
  parse(s: string): number;
  /** Returns the number of milliseconds since January 1, 1970 UTC for the specified date */
  UTC(year: number, month: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number;
  prototype: Date;
};

/**
 * Date instance methods
 */
interface Date {
  /** Returns a string representation of a date */
  toString(): string;
  /** Returns the date portion as a string */
  toDateString(): string;
  /** Returns the time portion as a string */
  toTimeString(): string;
  /** Returns a locale-specific string representation */
  toLocaleString(): string;
  /** Returns a locale-specific date string */
  toLocaleDateString(): string;
  /** Returns a locale-specific time string */
  toLocaleTimeString(): string;
  /** Returns the primitive value as a number */
  valueOf(): number;
  /** Returns the time value in milliseconds */
  getTime(): number;
  /** Returns the year (4 digits) */
  getFullYear(): number;
  /** Returns the UTC year (4 digits) */
  getUTCFullYear(): number;
  /** Returns the month (0-11) */
  getMonth(): number;
  /** Returns the UTC month (0-11) */
  getUTCMonth(): number;
  /** Returns the day of the month (1-31) */
  getDate(): number;
  /** Returns the UTC day of the month (1-31) */
  getUTCDate(): number;
  /** Returns the day of the week (0-6) */
  getDay(): number;
  /** Returns the UTC day of the week (0-6) */
  getUTCDay(): number;
  /** Returns the hours (0-23) */
  getHours(): number;
  /** Returns the UTC hours (0-23) */
  getUTCHours(): number;
  /** Returns the minutes (0-59) */
  getMinutes(): number;
  /** Returns the UTC minutes (0-59) */
  getUTCMinutes(): number;
  /** Returns the seconds (0-59) */
  getSeconds(): number;
  /** Returns the UTC seconds (0-59) */
  getUTCSeconds(): number;
  /** Returns the milliseconds (0-999) */
  getMilliseconds(): number;
  /** Returns the UTC milliseconds (0-999) */
  getUTCMilliseconds(): number;
  /** Returns the time-zone offset in minutes */
  getTimezoneOffset(): number;
  /** Sets the year */
  setFullYear(year: number, month?: number, date?: number): number;
  /** Sets the UTC year */
  setUTCFullYear(year: number, month?: number, date?: number): number;
  /** Sets the month */
  setMonth(month: number, date?: number): number;
  /** Sets the UTC month */
  setUTCMonth(month: number, date?: number): number;
  /** Sets the day of the month */
  setDate(date: number): number;
  /** Sets the UTC day of the month */
  setUTCDate(date: number): number;
  /** Sets the hours */
  setHours(hours: number, min?: number, sec?: number, ms?: number): number;
  /** Sets the UTC hours */
  setUTCHours(hours: number, min?: number, sec?: number, ms?: number): number;
  /** Sets the minutes */
  setMinutes(minutes: number, sec?: number, ms?: number): number;
  /** Sets the UTC minutes */
  setUTCMinutes(minutes: number, sec?: number, ms?: number): number;
  /** Sets the seconds */
  setSeconds(seconds: number, ms?: number): number;
  /** Sets the UTC seconds */
  setUTCSeconds(seconds: number, ms?: number): number;
  /** Sets the milliseconds */
  setMilliseconds(ms: number): number;
  /** Sets the UTC milliseconds */
  setUTCMilliseconds(ms: number): number;
  /** Sets the time value in milliseconds */
  setTime(time: number): number;
  /** Returns the ISO 8601 string representation */
  toISOString(): string;
  /** Returns the JSON representation */
  toJSON(): string;
}

// === Regular Expression Support ===

/**
 * Regular Expression constructor and static methods
 */
declare const RegExp: {
  new(pattern: string, flags?: string): RegExp;
  new(pattern: RegExp): RegExp;
  (pattern: string, flags?: string): RegExp;
  (pattern: RegExp): RegExp;
  prototype: RegExp;
};

/**
 * Regular Expression instance methods
 */
interface RegExp {
  /** Executes a search for a match in a string */
  exec(string: string): RegExpExecArray | null;
  /** Tests for a match in a string */
  test(string: string): boolean;
  /** Returns the source text of the RegExp object */
  readonly source: string;
  /** Returns a Boolean value indicating the global flag (g) */
  readonly global: boolean;
  /** Returns a Boolean value indicating the ignoreCase flag (i) */
  readonly ignoreCase: boolean;
  /** Returns a Boolean value indicating the multiline flag (m) */
  readonly multiline: boolean;
  /** Returns the index at which to start the next match */
  lastIndex: number;
}

/**
 * Result of RegExp.exec()
 */
interface RegExpExecArray extends Array<string> {
  /** The index of the start of the match */
  index: number;
  /** The original input string */
  input: string;
  /** Named capture groups */
  groups?: { [key: string]: string };
}

// === URL Support ===

/**
 * URL constructor for parsing and constructing URLs
 */
declare const URL: {
  new(url: string, base?: string | URL): URL;
  /** Creates an object URL for the given object */
  createObjectURL(object: any): string;
  /** Releases an object URL */
  revokeObjectURL(url: string): void;
};

/**
 * URL instance properties and methods
 */
interface URL {
  /** The entire URL */
  href: string;
  /** The origin of the URL */
  readonly origin: string;
  /** The protocol scheme of the URL */
  protocol: string;
  /** The username of the URL */
  username: string;
  /** The password of the URL */
  password: string;
  /** The host of the URL */
  host: string;
  /** The hostname of the URL */
  hostname: string;
  /** The port number of the URL */
  port: string;
  /** The path of the URL */
  pathname: string;
  /** The query string of the URL */
  search: string;
  /** The fragment identifier of the URL */
  hash: string;
  /** The search parameters of the URL */
  readonly searchParams: URLSearchParams;
  /** Returns the entire URL as a string */
  toString(): string;
  /** Returns the entire URL as a string */
  toJSON(): string;
}

/**
 * URLSearchParams for working with URL query parameters
 */
declare const URLSearchParams: {
  new(init?: string | string[][] | Record<string, string> | URLSearchParams): URLSearchParams;
};

interface URLSearchParams {
  /** Appends a new name/value pair */
  append(name: string, value: string): void;
  /** Deletes all name/value pairs with the given name */
  delete(name: string): void;
  /** Returns all values associated with the given name */
  getAll(name: string): string[];
  /** Returns the first value associated with the given name */
  get(name: string): string | null;
  /** Returns true if the given name exists */
  has(name: string): boolean;
  /** Sets the value associated with the given name */
  set(name: string, value: string): void;
  /** Sorts all name/value pairs by name */
  sort(): void;
  /** Returns a string representation */
  toString(): string;
  /** Returns an iterator for all names */
  keys(): IterableIterator<string>;
  /** Returns an iterator for all values */
  values(): IterableIterator<string>;
  /** Returns an iterator for all name/value pairs */
  entries(): IterableIterator<[string, string]>;
  /** Iterator interface */
  [Symbol.iterator](): IterableIterator<[string, string]>;
  /** Executes a callback for each name/value pair */
  forEach(callback: (value: string, name: string, parent: URLSearchParams) => void, thisArg?: any): void;
}

// === Promise and Async Support ===

/**
 * Promise constructor with enhanced typing
 */
declare const Promise: {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
  /** Creates a resolved promise */
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  /** Creates a resolved promise with no value */
  resolve(): Promise<void>;
  /** Creates a rejected promise */
  reject<T = never>(reason?: any): Promise<T>;
  /** Returns a promise that resolves when all input promises resolve */
  all<T>(values: readonly (T | PromiseLike<T>)[]): Promise<T[]>;
  /** Returns a promise that resolves when the first input promise resolves */
  race<T>(values: readonly (T | PromiseLike<T>)[]): Promise<T>;
  /** Returns a promise that resolves when all input promises settle */
  allSettled<T>(values: readonly (T | PromiseLike<T>)[]): Promise<PromiseSettledResult<T>[]>;
  /** Returns a promise that resolves with the first fulfilled promise or rejects if all reject */
  any<T>(values: readonly (T | PromiseLike<T>)[]): Promise<T>;
};

/**
 * Result of Promise.allSettled()
 */
type PromiseSettledResult<T> = PromiseFulfilledResult<T> | PromiseRejectedResult;

interface PromiseFulfilledResult<T> {
  status: 'fulfilled';
  value: T;
}

interface PromiseRejectedResult {
  status: 'rejected';
  reason: any;
}

/**
 * Promise instance methods
 */
interface Promise<T> {
  /** Attaches callbacks for the resolution and/or rejection of the Promise */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  /** Attaches a callback for only the rejection of the Promise */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<T | TResult>;
  /** Attaches a callback that is invoked when the Promise is settled */
  finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}

// === Security Utilities ===

/**
 * Generates a random UUID v4 string
 * Useful for creating unique test identifiers
 */
declare function crypto(): {
  randomUUID(): string;
};

// === Type Guards and Utilities ===

/**
 * Type guard to check if a value is a string
 */
declare function isString(value: any): value is string;

/**
 * Type guard to check if a value is a number
 */
declare function isNumber(value: any): value is number;

/**
 * Type guard to check if a value is a boolean
 */
declare function isBoolean(value: any): value is boolean;

/**
 * Type guard to check if a value is an object
 */
declare function isObject(value: any): value is object;

/**
 * Type guard to check if a value is an array
 */
declare function isArray(value: any): value is any[];

/**
 * Sleep function for adding delays in tests
 * @param ms Milliseconds to wait
 * @returns Promise that resolves after the specified time
 * 
 * @example
 * ```typescript
 * // Wait for 2 seconds
 * await sleep(2000);
 * ```
 */
declare function sleep(ms: number): Promise<void>;
