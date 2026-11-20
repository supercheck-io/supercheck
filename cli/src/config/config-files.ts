/** Config file names in the order every command looks for them: TypeScript, then CommonJS/ESM JavaScript. */
export const CONFIG_FILES = ['supercheck.config.ts', 'supercheck.config.js', 'supercheck.config.mjs'] as const

/** Local overrides, merged over the main config, in the same order. */
export const LOCAL_CONFIG_FILES = ['supercheck.config.local.ts', 'supercheck.config.local.js', 'supercheck.config.local.mjs'] as const
