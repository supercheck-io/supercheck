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
    /** Sends HTTP(S) request and returns its response. This is a general-purpose fetch method that supports any HTTP method. */
    fetch(urlOrRequest: string | Request, options?: { data?: any; form?: { [key: string]: string | number | boolean }; headers?: { [key: string]: string }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; method?: string; multipart?: { [key: string]: string | number | boolean | ReadStream | { name: string; mimeType: string; buffer: Buffer } }; params?: { [key: string]: string | number | boolean }; timeout?: number; failOnStatusCode?: boolean }): Promise<Response>;
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

// === Complete k6 Performance Testing Type Definitions ===

/**
 * k6 Core Module - Performance testing functions
 * https://grafana.com/docs/k6/latest/javascript-api/k6/
 */
declare module "k6" {
  /**
   * Check procedure for validating values.
   * @template VT - The type of value being checked
   */
  export interface Checker<VT> {
    /** Check procedure that returns true if check passed. */
    (val: VT): boolean;
  }

  /**
   * Named check procedures mapped by description.
   * @template VT - The type of value being checked
   */
  export interface Checkers<VT> {
    [description: string]: Checker<VT>;
  }

  /**
   * Run checks on a value.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/check/
   * @template VT - Value type
   * @param val - Value to test
   * @param sets - Tests (checks) to run on the value
   * @param tags - Extra tags to attach to metrics emitted
   * @returns `true` if all checks have succeeded, otherwise `false`
   * @example
   * ```javascript
   * check(res, {
   *   "response code was 200": (res) => res.status === 200,
   *   "body size was correct": (res) => res.body.length === 1234,
   * });
   * ```
   */
  export function check<VT>(val: VT, sets: Checkers<VT>, tags?: object): boolean;

  /**
   * Immediately throw an error, aborting the current script iteration.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/fail/
   * @param err - Error message that gets printed to stderr
   * @example
   * ```javascript
   * fail("abort current iteration");
   * ```
   */
  export function fail(err?: string): never;

  /**
   * Run code inside a group for organizing test logic.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/group/
   * @template RT - Return type
   * @param name - Name of the group
   * @param fn - Group body. Code to be executed in the group context
   * @returns The return value of `fn`
   * @example
   * ```javascript
   * group("user login flow", function() {
   *   // login logic here
   * });
   * ```
   */
  export function group<RT>(name: string, fn: () => RT): RT;

  /**
   * Set seed to get a reproducible pseudo-random number using Math.random.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/randomseed/
   * @param int - The seed value
   * @example
   * ```javascript
   * randomSeed(123456789);
   * ```
   */
  export function randomSeed(int: number): void;

  /**
   * Suspend VU execution for the specified duration.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/sleep/
   * @param t - Duration in seconds (can be fractional)
   * @example
   * ```javascript
   * sleep(1);      // Sleep for 1 second
   * sleep(0.5);    // Sleep for 500ms
   * sleep(Math.random() * 3); // Random sleep 0-3 seconds
   * ```
   */
  export function sleep(t: number): void;
}

/**
 * k6 HTTP Module - HTTP client for load testing
 * https://grafana.com/docs/k6/latest/javascript-api/k6-http/
 */
declare module "k6/http" {
  /**
   * HTTP request timing information
   */
  export interface ResponseTimings {
    /** Time waiting for first byte of response */
    waiting: number;
    /** Time receiving data */
    receiving: number;
    /** Time establishing TCP connection */
    connecting: number;
    /** Time for TLS handshake */
    tls_handshaking: number;
    /** Time sending request data */
    sending: number;
    /** Time blocked before initiating the request */
    blocked: number;
    /** Time resolving DNS */
    looking_up: number;
    /** Total request duration */
    duration: number;
  }

  /**
   * Cookie object received in response
   */
  export interface ResponseCookie {
    /** Cookie name */
    name: string;
    /** Cookie value */
    value: string;
    /** Cookie domain */
    domain: string;
    /** Cookie path */
    path: string;
    /** Expiration time (Unix timestamp) */
    expires: number;
    /** Max age in seconds */
    max_age: number;
    /** HTTP only flag */
    httpOnly: boolean;
    /** Secure flag */
    secure: boolean;
    /** SameSite attribute */
    sameSite: "Strict" | "Lax" | "None";
  }

  /**
   * HTTP Response object returned by all request methods
   */
  export interface Response {
    /** Response body as a string. Use json() to parse JSON. */
    body: string | null;
    /** HTTP response headers */
    headers: { [key: string]: string };
    /** HTTP status code (e.g., 200, 404, 500) */
    status: number;
    /** HTTP status text (e.g., "OK", "Not Found") */
    status_text: string;
    /** Final URL after any redirects */
    url: string;
    /** Error message if request failed */
    error: string;
    /** Error code for failed requests */
    error_code: number;
    /** Request timing information */
    timings: ResponseTimings;
    /** Cookies set by the server */
    cookies: { [name: string]: ResponseCookie[] };
    /** The request that generated this response */
    request: {
      method: string;
      url: string;
      headers: { [key: string]: string };
      body: string;
      cookies: { [key: string]: { value: string; replace: boolean }[] };
    };
    /** Parse response body as JSON */
    json(selector?: string): any;
    /** Parse response body as HTML for jQuery-like selection */
    html(selector?: string): any;
    /** Submit a form from the response */
    submitForm(options?: { formSelector?: string; fields?: object; submitSelector?: string; params?: Params }): Response;
    /** Click a link in the response */
    clickLink(options?: { selector?: string; params?: Params }): Response;
  }

  /**
   * HTTP request parameters
   */
  export interface Params {
    /** Request-specific cookies */
    cookies?: { [name: string]: string | { value: string; replace?: boolean } };
    /** Request headers */
    headers?: { [key: string]: string };
    /** Cookie jar to use for the request */
    jar?: CookieJar;
    /** Maximum number of redirects to follow (default: 10) */
    redirects?: number;
    /** Tags to attach to metrics */
    tags?: { [key: string]: string };
    /** Request timeout (default: 60s). Number in ms or string like "30s" */
    timeout?: string | number;
    /** Compression algorithm: "gzip", "deflate", "br", "zstd" */
    compression?: string;
    /** Response type: "text" (default), "binary", or "none" */
    responseType?: "text" | "binary" | "none";
    /** Authentication method: "basic", "digest", "ntlm" */
    auth?: "basic" | "digest" | "ntlm";
  }

  /**
   * Cookie jar for managing cookies
   */
  export interface CookieJar {
    /** Set a cookie in the jar */
    set(url: string, name: string, value: string, options?: { domain?: string; path?: string; expires?: string; max_age?: number; secure?: boolean; http_only?: boolean }): void;
    /** Get cookies for a URL */
    cookiesForURL(url: string): { [name: string]: string[] };
    /** Clear all cookies from the jar */
    clear(url: string): void;
    /** Delete a specific cookie */
    delete(url: string, name: string): void;
  }

  /**
   * Batch request definition - array format
   */
  export type BatchRequest = [method: string, url: string, body?: string | object | null, params?: Params];

  /**
   * Batch request definition - object format
   */
  export interface BatchRequestObject {
    method: string;
    url: string;
    body?: string | object | null;
    params?: Params;
  }

  /**
   * Perform an HTTP GET request.
   * https://grafana.com/docs/k6/latest/javascript-api/k6-http/get/
   * @param url - Request URL
   * @param params - Optional request parameters
   * @returns HTTP Response object
   * @example
   * ```javascript
   * const res = http.get("https://test-api.k6.io/public/crocodiles/1/");
   * console.log(res.status); // 200
   * ```
   */
  export function get(url: string, params?: Params): Response;

  /**
   * Perform an HTTP POST request.
   * https://grafana.com/docs/k6/latest/javascript-api/k6-http/post/
   * @param url - Request URL
   * @param body - Request body (string, object, or null)
   * @param params - Optional request parameters
   * @returns HTTP Response object
   * @example
   * ```javascript
   * const payload = JSON.stringify({ username: "test", password: "secret" });
   * const res = http.post("https://api.example.com/login", payload, {
   *   headers: { "Content-Type": "application/json" }
   * });
   * ```
   */
  export function post(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP PUT request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function put(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP DELETE request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function del(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP PATCH request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function patch(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP HEAD request.
   * @param url - Request URL
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function head(url: string, params?: Params): Response;

  /**
   * Perform an HTTP OPTIONS request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function options(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform a generic HTTP request.
   * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function request(method: string, url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform multiple HTTP requests in parallel.
   * https://grafana.com/docs/k6/latest/javascript-api/k6-http/batch/
   * @param requests - Array or object of request definitions
   * @returns Array or object of Response objects
   * @example
   * ```javascript
   * const responses = http.batch([
   *   ["GET", "https://api.example.com/users"],
   *   ["GET", "https://api.example.com/posts"],
   * ]);
   * ```
   */
  export function batch(requests: (BatchRequest | BatchRequestObject)[]): Response[];
  export function batch(requests: { [key: string]: BatchRequest | BatchRequestObject }): { [key: string]: Response };

  /**
   * Create a new cookie jar.
   * @returns A new CookieJar instance
   */
  export function cookieJar(): CookieJar;

  /**
   * Encode an object as multipart/form-data.
   * @param data - Object containing form fields and file data
   * @param boundary - Optional boundary string
   * @returns Encoded string suitable for request body
   */
  export function file(data: ArrayBuffer | string, filename?: string, contentType?: string): object;

  /**
   * Set the default response callback for all HTTP requests.
   * @param callback - Callback function to process responses
   */
  export function setResponseCallback(callback: ((response: Response) => void) | null): void;

  /**
   * Expected HTTP statuses for response validation.
   * @param statuses - Expected status codes
   * @returns Callback for setResponseCallback
   */
  export function expectedStatuses(...statuses: (number | { min: number; max: number })[]): (response: Response) => void;

  /** Default HTTP module export */
  const http: {
    get: typeof get;
    post: typeof post;
    put: typeof put;
    del: typeof del;
    patch: typeof patch;
    head: typeof head;
    options: typeof options;
    request: typeof request;
    batch: typeof batch;
    cookieJar: typeof cookieJar;
    file: typeof file;
    setResponseCallback: typeof setResponseCallback;
    expectedStatuses: typeof expectedStatuses;
  };
  export default http;
}

/**
 * k6 Metrics Module - Custom metrics for performance analysis
 * https://grafana.com/docs/k6/latest/javascript-api/k6-metrics/
 */
declare module "k6/metrics" {
  /**
   * Counter metric - cumulative count that can only increase
   * @example
   * ```javascript
   * const myCounter = new Counter("my_requests");
   * myCounter.add(1);
   * myCounter.add(5, { tag: "value" });
   * ```
   */
  export class Counter {
    /** Create a new Counter metric */
    constructor(name: string, isTime?: boolean);
    /** Add a value to the counter */
    add(value: number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }

  /**
   * Gauge metric - stores the last value added
   * @example
   * ```javascript
   * const myGauge = new Gauge("current_connections");
   * myGauge.add(10);
   * myGauge.add(5); // Now value is 5
   * ```
   */
  export class Gauge {
    /** Create a new Gauge metric */
    constructor(name: string, isTime?: boolean);
    /** Set the gauge value */
    add(value: number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }

  /**
   * Rate metric - tracks the percentage of added values that are non-zero
   * @example
   * ```javascript
   * const errorRate = new Rate("errors");
   * errorRate.add(false); // success
   * errorRate.add(true);  // failure - rate increases
   * ```
   */
  export class Rate {
    /** Create a new Rate metric */
    constructor(name: string);
    /** Add a value (true/1 = failure, false/0 = success) */
    add(value: boolean | number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }

  /**
   * Trend metric - calculates statistics (min, max, avg, percentiles)
   * @example
   * ```javascript
   * const responseTime = new Trend("response_time");
   * responseTime.add(245);
   * responseTime.add(150);
   * // Access via thresholds: 'response_time': ['avg<300', 'p(95)<500']
   * ```
   */
  export class Trend {
    /** Create a new Trend metric */
    constructor(name: string, isTime?: boolean);
    /** Add a value to calculate statistics from */
    add(value: number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }
}

/**
 * k6 WebSocket Module - WebSocket client for real-time testing
 * https://grafana.com/docs/k6/latest/javascript-api/k6-ws/
 */
declare module "k6/ws" {
  /**
   * WebSocket connection parameters
   */
  export interface WSParams {
    /** Request headers */
    headers?: { [key: string]: string };
    /** Tags for metrics */
    tags?: { [key: string]: string };
    /** Compression mode */
    compression?: string;
  }

  /**
   * WebSocket socket instance
   */
  export interface Socket {
    /** Close the WebSocket connection */
    close(code?: number): void;
    /** Register a handler for events */
    on(event: "open" | "message" | "ping" | "pong" | "close" | "error", callback: (data?: any) => void): void;
    /** Send data through the WebSocket */
    send(data: string): void;
    /** Send binary data */
    sendBinary(data: ArrayBuffer): void;
    /** Send a ping */
    ping(): void;
    /** Set a timeout callback */
    setTimeout(callback: () => void, timeout: number): void;
    /** Set an interval callback */
    setInterval(callback: () => void, interval: number): void;
  }

  /**
   * WebSocket connection response
   */
  export interface WSResponse {
    /** HTTP status code of the upgrade response */
    status: number;
    /** Response headers */
    headers: { [key: string]: string };
    /** Body from the upgrade response */
    body: string;
    /** Error message if connection failed */
    error: string;
    /** URL of the connection */
    url: string;
  }

  /**
   * Connect to a WebSocket server.
   * @param url - WebSocket URL (ws:// or wss://)
   * @param params - Connection parameters
   * @param callback - Callback function receiving the socket
   * @returns WebSocket response object
   * @example
   * ```javascript
   * const res = ws.connect("wss://echo.websocket.org", {}, function(socket) {
   *   socket.on("open", () => socket.send("Hello!"));
   *   socket.on("message", (msg) => console.log(msg));
   *   socket.on("close", () => console.log("Disconnected"));
   * });
   * ```
   */
  export function connect(url: string, params: WSParams, callback: (socket: Socket) => void): WSResponse;
  export function connect(url: string, callback: (socket: Socket) => void): WSResponse;

  /** Default WebSocket module export */
  const ws: {
    connect: typeof connect;
  };
  export default ws;
}

/**
 * k6 gRPC Module - gRPC client for performance testing
 * https://grafana.com/docs/k6/latest/javascript-api/k6-net-grpc/
 */
declare module "k6/net/grpc" {
  /**
   * gRPC connection parameters
   */
  export interface GRPCParams {
    /** Metadata to send with requests */
    metadata?: { [key: string]: string };
    /** Tags for metrics */
    tags?: { [key: string]: string };
    /** Request timeout */
    timeout?: string | number;
  }

  /**
   * gRPC response object
   */
  export interface GRPCResponse {
    /** Response status code */
    status: number;
    /** Response message (parsed) */
    message: any;
    /** Response headers */
    headers: { [key: string]: string };
    /** Response trailers */
    trailers: { [key: string]: string };
    /** Error if request failed */
    error: any;
  }

  /**
   * gRPC stream object for streaming calls
   */
  export interface Stream {
    /** Register event handlers */
    on(event: "data" | "error" | "end", callback: (data?: any) => void): void;
    /** Write data to the stream (client streaming) */
    write(message: object): void;
    /** Signal end of client stream */
    end(): void;
  }

  /**
   * gRPC client for making RPC calls
   */
  export class Client {
    /** Create a new gRPC client */
    constructor();
    /** Load protobuf definitions */
    load(importPaths: string[], protoFiles: string | string[]): void;
    /** Load protobuf definitions from binary */
    loadProtoset(protosetPath: string): void;
    /** Connect to a gRPC server */
    connect(address: string, options?: { plaintext?: boolean; reflect?: boolean; timeout?: string | number; maxReceiveSize?: number; maxSendSize?: number; tls?: { cert?: string; key?: string; cacerts?: string; insecure?: boolean } }): void;
    /** Invoke a unary RPC method */
    invoke(method: string, request: object, params?: GRPCParams): GRPCResponse;
    /** Invoke an async unary RPC method (k6 v0.49.0+) */
    asyncInvoke(method: string, request: object, params?: GRPCParams): Promise<GRPCResponse>;
    /** Close the client connection */
    close(): void;
  }

  /**
   * gRPC status codes
   */
  export const StatusOK: number;
  export const StatusCancelled: number;
  export const StatusUnknown: number;
  export const StatusInvalidArgument: number;
  export const StatusDeadlineExceeded: number;
  export const StatusNotFound: number;
  export const StatusAlreadyExists: number;
  export const StatusPermissionDenied: number;
  export const StatusResourceExhausted: number;
  export const StatusFailedPrecondition: number;
  export const StatusAborted: number;
  export const StatusOutOfRange: number;
  export const StatusUnimplemented: number;
  export const StatusInternal: number;
  export const StatusUnavailable: number;
  export const StatusDataLoss: number;
  export const StatusUnauthenticated: number;

  /** Default gRPC module export */
  const grpc: {
    Client: typeof Client;
    StatusOK: typeof StatusOK;
    StatusCancelled: typeof StatusCancelled;
    StatusUnknown: typeof StatusUnknown;
    StatusInvalidArgument: typeof StatusInvalidArgument;
    StatusDeadlineExceeded: typeof StatusDeadlineExceeded;
    StatusNotFound: typeof StatusNotFound;
    StatusAlreadyExists: typeof StatusAlreadyExists;
    StatusPermissionDenied: typeof StatusPermissionDenied;
    StatusResourceExhausted: typeof StatusResourceExhausted;
    StatusFailedPrecondition: typeof StatusFailedPrecondition;
    StatusAborted: typeof StatusAborted;
    StatusOutOfRange: typeof StatusOutOfRange;
    StatusUnimplemented: typeof StatusUnimplemented;
    StatusInternal: typeof StatusInternal;
    StatusUnavailable: typeof StatusUnavailable;
    StatusDataLoss: typeof StatusDataLoss;
    StatusUnauthenticated: typeof StatusUnauthenticated;
  };
  export default grpc;
}

// Buffer type for screenshots and file handling
declare type Buffer = any;
declare type ReadStream = any;

// === Supercheck Global Functions ===

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
 * Retrieves a project secret value.
 * 
 * Project secrets are encrypted at rest using AES-128 encryption and are designed
 * for sensitive values such as passwords, API keys, tokens, and database credentials.
 * Values are resolved at runtime and execution output is redacted to avoid accidental exposure.
 * 
 * @param key - The secret key name as defined in project settings
 * @param options - Configuration options for retrieval and type conversion
 * @returns Secret value with optional type conversion
 * 
 * @throws {Error} When `options.required` is true and the secret is not defined
 * @throws {Error} When type conversion fails (e.g., invalid number format)
 * @throws {Error} When decryption fails due to invalid encryption key or corrupted data
 * 
 * @example Basic usage
 * ```typescript
 * const password = getSecret('USER_PASSWORD');
 * const apiToken = getSecret('API_TOKEN');
 *
 * // Works seamlessly with Playwright and other APIs
 * await page.fill('#password', password);
 * await page.setExtraHTTPHeaders({
 *   'Authorization': `Bearer ${apiToken}`
 * });
 * ```
 * 
 * @example Explicit type conversion
 * ```typescript
 * const apiKey = getSecret('API_KEY', { type: 'string' });
 * const dbPort = getSecret('DB_PORT', { type: 'number' });
 * const sslEnabled = getSecret('SSL_ENABLED', { type: 'boolean' });
 *
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
 *   if (token) {
 *     // Token exists, use it
 *   }
 * } catch (error) {
 *   console.error('Failed to retrieve secret:', error.message);
 * }
 * ```
 * 
 * @security
 * - Secrets are encrypted using AES-128-GCM with project-specific context
 * - Secret values are not embedded in generated script source
 * - Runtime console output and execution logs are redacted
 * - No secret values are ever sent to the browser UI from variable APIs
 * 
 * @see {@link getVariable} For non-sensitive configuration values
 */
declare function getSecret<T = string>(
  key: string,
  options?: VariableOptions<T>
): T extends number ? number
  : T extends boolean ? boolean
  : string;

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
