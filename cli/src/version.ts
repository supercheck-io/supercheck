// Version is injected at build time by tsup via define
declare const __CLI_VERSION__: string

export const CLI_VERSION: string = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev'
