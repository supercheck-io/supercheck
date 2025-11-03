import type {
  AppControllerRoute,
  AppViewRoute,
  BullBoardQueues,
  ControllerHandlerReturnType,
  HTTPMethod,
  IServerAdapter,
  UIConfig,
} from "@bull-board/api/typings/app";

type RouteParams = Record<string, string>;

type RouteMatch = {
  params: RouteParams;
};

type RouteMatcher = {
  originalRoute: string;
  match: (path: string) => RouteMatch | null;
};

type PreparedControllerRoute = {
  methods: Set<string>;
  matchers: RouteMatcher[];
  handler: AppControllerRoute["handler"];
};

type PreparedViewRoute = {
  method: string;
  matchers: RouteMatcher[];
  handler: AppViewRoute["handler"];
};

export type NextBullBoardAdapterState = {
  basePath: string;
  queues: BullBoardQueues;
  viewsPath: string;
  staticRoute: string;
  staticPath: string;
  apiRoutes: PreparedControllerRoute[];
  entryRoute: PreparedViewRoute;
  uiConfig: UIConfig;
  errorHandler: (error: Error) => ControllerHandlerReturnType;
};

const ESCAPE_REGEX = /[.+*?^${}()|[\]\\]/g;

const normalizePath = (value: string): string => {
  if (!value) {
    return "/";
  }

  if (!value.startsWith("/")) {
    return `/${value}`;
  }

  return value === "/" ? "/" : value.replace(/\/+$/, "").replace(/\/+/g, "/");
};

const stripTrailingSlash = (value: string): string => {
  if (value.length > 1 && value.endsWith("/")) {
    return value.replace(/\/+$/, "");
  }

  return value || "/";
};

const createRouteMatcher = (route: string): RouteMatcher => {
  const normalizedRoute = normalizePath(route);

  if (normalizedRoute === "/") {
    return {
      originalRoute: route,
      match: (path: string) => {
        const normalizedPath = stripTrailingSlash(path || "/");
        return normalizedPath === "/" ? { params: {} } : null;
      },
    };
  }

  const segments = normalizedRoute.slice(1).split("/");
  const paramNames: string[] = [];

  const regexParts = segments.map((segment) => {
    if (segment.startsWith(":")) {
      paramNames.push(segment.slice(1));
      return "([^/]+)";
    }

    return segment.replace(ESCAPE_REGEX, "\\$&");
  });

  const regex = new RegExp(`^/${regexParts.join("/")}$`);

  return {
    originalRoute: route,
    match: (path: string) => {
      const normalizedPath = stripTrailingSlash(path || "/");
      const match = regex.exec(normalizedPath);
      if (!match) {
        return null;
      }

      const params: RouteParams = {};
      paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });

      return { params };
    },
  };
};

const normalizeMethod = (method: HTTPMethod): string => method.toUpperCase();

const ensureArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

export class NextBullBoardAdapter implements IServerAdapter {
  private basePath = "/";
  private queues: BullBoardQueues | null = null;
  private viewsPath: string | null = null;
  private staticRoute = "/static";
  private staticPath: string | null = null;
  private apiRoutes: PreparedControllerRoute[] = [];
  private entryRoute: PreparedViewRoute | null = null;
  private uiConfig: UIConfig = {};
  private errorHandler: ((error: Error) => ControllerHandlerReturnType) | null = null;

  setBasePath(path: string): this {
    this.basePath = normalizePath(path);
    return this;
  }

  setQueues(bullBoardQueues: BullBoardQueues): this {
    this.queues = bullBoardQueues;
    return this;
  }

  setViewsPath(viewPath: string): this {
    this.viewsPath = viewPath;
    return this;
  }

  setStaticPath(staticsRoute: string, staticsPath: string): this {
    this.staticRoute = normalizePath(staticsRoute);
    this.staticPath = staticsPath;
    return this;
  }

  setEntryRoute(route: AppViewRoute): this {
    const method = normalizeMethod(route.method);
    const matchers = ensureArray(route.route).map(createRouteMatcher);
    this.entryRoute = {
      method,
      matchers,
      handler: route.handler,
    };
    return this;
  }

  setErrorHandler(handler: (error: Error) => ControllerHandlerReturnType): this {
    this.errorHandler = handler;
    return this;
  }

  setApiRoutes(routes: AppControllerRoute[]): this {
    this.apiRoutes = routes.map((route) => ({
      methods: new Set(ensureArray(route.method).map(normalizeMethod)),
      matchers: ensureArray(route.route).map(createRouteMatcher),
      handler: route.handler,
    }));
    return this;
  }

  setUIConfig(config: UIConfig): this {
    this.uiConfig = config;
    return this;
  }

  getState(): NextBullBoardAdapterState {
    if (!this.queues) {
      throw new Error("Bull Board queues are not configured");
    }

    if (!this.viewsPath) {
      throw new Error("Bull Board views path is not configured");
    }

    if (!this.staticPath) {
      throw new Error("Bull Board static path is not configured");
    }

    if (!this.entryRoute) {
      throw new Error("Bull Board entry route is not configured");
    }

    if (!this.errorHandler) {
      throw new Error("Bull Board error handler is not configured");
    }

    return {
      basePath: this.basePath,
      queues: this.queues,
      viewsPath: this.viewsPath,
      staticRoute: this.staticRoute,
      staticPath: this.staticPath,
      apiRoutes: this.apiRoutes,
      entryRoute: this.entryRoute,
      uiConfig: this.uiConfig,
      errorHandler: this.errorHandler,
    };
  }
}
