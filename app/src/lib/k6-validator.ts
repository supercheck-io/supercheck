/* ================================
   K6 SCRIPT VALIDATOR
   -------------------------------
   Validates k6 performance test scripts for common issues
=================================== */

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { hasUnboundHelperCall } from './helper-call-analysis';
import { validateScriptSyntax } from './script-validation';
import { transpileTypeScript } from './ts-transpiler';

export interface K6ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface K6ValidationOptions {
  selectedTestType?: string;
}

/** Upper bounds for literal options; matches the 60 min default run timeout. Dynamic values are left to k6/worker. */
export const K6_MAX_VUS = 1000;
export const K6_MAX_DURATION_MS = 60 * 60 * 1000;

const DURATION_UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;

function literalDurationMs(node: acorn.Expression | acorn.Pattern): number | undefined {
  if (node.type !== 'Literal') return undefined;
  if (typeof node.value === 'number') return node.value;
  if (typeof node.value !== 'string') return undefined;
  if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(node.value)) return undefined;
  let total = 0;
  for (const [, n, unit] of node.value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) total += Number(n) * DURATION_UNIT_MS[unit as keyof typeof DURATION_UNIT_MS];
  return total;
}

/** Errors for literal VU/duration values above the limits in top-level `options`. */
function findOptionLimitErrors(script: string): string[] {
  const errors: string[] = [];
  const ast = acorn.parse(script, { ecmaVersion: 'latest', sourceType: 'module' });
  const keyOf = (p: acorn.Property) =>
    p.computed ? undefined : p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : undefined;
  const checkVus = (name: string, v: acorn.Expression | acorn.Pattern) => {
    if (v.type === 'Literal' && typeof v.value === 'number' && v.value > K6_MAX_VUS)
      errors.push(`k6 option "${name}" (${v.value}) exceeds the maximum of ${K6_MAX_VUS} virtual users.`);
  };
  const checkDuration = (v: acorn.Expression | acorn.Pattern) => {
    const ms = literalDurationMs(v);
    if (ms !== undefined && ms > K6_MAX_DURATION_MS)
      errors.push(`k6 duration exceeds the maximum of ${K6_MAX_DURATION_MS / 60_000} minutes.`);
  };
  const get = (obj: acorn.ObjectExpression, name: string) =>
    obj.properties.find((p): p is acorn.Property => p.type === 'Property' && keyOf(p) === name)?.value;
  // Only load keys are checked, so values under tags/env/thresholds are ignored.
  const checkLoad = (obj: acorn.ObjectExpression, stageTargetsAreVus: boolean) => {
    for (const k of ['vus', 'maxVUs', 'preAllocatedVUs']) {
      const v = get(obj, k);
      if (v) checkVus(k, v);
    }
    const duration = get(obj, 'duration');
    if (duration) checkDuration(duration);
    const stages = get(obj, 'stages');
    if (stages?.type !== 'ArrayExpression') return;
    // Stages run back to back, so their durations add up.
    let total = 0;
    for (const el of stages.elements) {
      if (el?.type !== 'ObjectExpression') continue;
      const target = get(el, 'target');
      if (stageTargetsAreVus && target) checkVus('stages.target', target);
      const dur = get(el, 'duration');
      total += (dur && literalDurationMs(dur)) || 0;
    }
    if (total > K6_MAX_DURATION_MS) checkDuration({ type: 'Literal', value: total } as acorn.Literal);
  };
  for (const node of ast.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id.type !== 'Identifier' || d.id.name !== 'options' || d.init?.type !== 'ObjectExpression') continue;
      checkLoad(d.init, true);
      const scenarios = get(d.init, 'scenarios');
      if (scenarios?.type !== 'ObjectExpression') continue;
      for (const sc of scenarios.properties) {
        if (sc.type !== 'Property' || sc.value.type !== 'ObjectExpression') continue;
        const executor = get(sc.value, 'executor');
        checkLoad(sc.value, executor?.type === 'Literal' && executor.value === 'ramping-vus');
      }
    }
  }
  return [...new Set(errors)];
}

function collectModuleSpecifiers(script: string): Set<string> {
  const modules = new Set<string>();
  const ast = acorn.parse(script, {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  walk.simple(ast, {
    ImportDeclaration(node) {
      modules.add(String(node.source.value));
    },
    ExportNamedDeclaration(node) {
      if (node.source) modules.add(String(node.source.value));
    },
    ExportAllDeclaration(node) {
      modules.add(String(node.source.value));
    },
    CallExpression(node) {
      const first = node.arguments[0];
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        first?.type === 'Literal' &&
        typeof first.value === 'string'
      )
        modules.add(first.value);
    },
  });
  return modules;
}

function isK6ModuleSpecifier(moduleSpecifier: string): boolean {
  return moduleSpecifier === 'k6' || moduleSpecifier.startsWith('k6/');
}

/** Reject only statically missing entrypoints; dynamic options are checked by k6. */
function isMissingEntrypoint(script: string): boolean {
  const ast = acorn.parse(script, { ecmaVersion: 'latest', sourceType: 'module' });
  let optionsName: string | undefined;
  for (const node of ast.body) {
    if (node.type === 'ExportDefaultDeclaration' || node.type === 'ExportAllDeclaration') return false;
    if (node.type !== 'ExportNamedDeclaration') continue;
    for (const specifier of node.specifiers) {
      const name = specifier.exported.type === 'Identifier'
        ? specifier.exported.name : specifier.exported.value;
      if (name === 'default') return false;
      if (name === 'options') {
        if (node.source) return false;
        if (specifier.local.type !== 'Identifier') return false;
        optionsName = specifier.local.name;
      }
    }
  }
  if (!optionsName) return true;
  let dynamicOptions = false;
  walk.fullAncestor(ast, (baseNode, _state, ancestors) => {
    const node = baseNode as acorn.AnyNode;
    if (node.type !== 'Identifier' || node.name !== optionsName) return;
    const parent = ancestors[ancestors.length - 2] as acorn.AnyNode | undefined;
    if (parent?.type === 'ExportSpecifier') return;
    if (parent?.type === 'VariableDeclarator' && parent.id === node) return;
    dynamicOptions = true;
  });
  if (dynamicOptions) return false;
  for (const node of ast.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const declaration of node.declarations) {
      if (declaration.id.type !== 'Identifier' || declaration.id.name !== optionsName) continue;
      if (declaration.init?.type !== 'ObjectExpression') return false;
      return !declaration.init.properties.some((property) =>
        property.type === 'SpreadElement' || property.computed ||
        (property.key.type === 'Identifier' ? property.key.name :
          property.key.type === 'Literal' ? property.key.value : undefined) === 'scenarios',
      );
    }
  }
  return false;
}

/**
 * Detects whether a script imports any k6 modules.
 */
export const isK6Script = (script: string): boolean => {
  const parsed = transpileTypeScript(script, { preserveValueImports: true });
  if (!parsed.success) return false;
  const moduleSpecifiers = collectModuleSpecifiers(parsed.code);
  for (const moduleSpecifier of moduleSpecifiers) {
    if (isK6ModuleSpecifier(moduleSpecifier)) {
      return true;
    }
  }
  return false;
};

/**
 * Validates a k6 script for common issues and best practices
 */
export function validateK6Script(
  script: string,
  options: K6ValidationOptions = {},
): K6ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const syntax = validateScriptSyntax(script);
  if (!syntax.valid)
    return { valid: false, errors: [syntax.error!], warnings: [] };

  // Transpile TypeScript to JavaScript for regex-based validation.
  // Malformed syntax is an error in every submission path.
  const transpileResult = transpileTypeScript(script);
  let jsCode: string;
  if (transpileResult.success) {
    jsCode = transpileResult.code;
  } else {
    return {
      valid: false,
      errors: [`Syntax error: ${transpileResult.message}`],
      warnings: [],
    };
  }

  const normalizedType = options.selectedTestType?.toLowerCase();
  const scriptLooksLikeK6 = isK6Script(script);
  const isPerformanceType =
    normalizedType === 'performance' || normalizedType === 'k6';

  if (normalizedType && !isPerformanceType) {
    errors.push(
      `k6 scripts can only run when the test type is set to Performance. Current type: "${options.selectedTestType}".`,
    );
  }

  if (!scriptLooksLikeK6) {
    errors.push(
      'This script does not import any k6 modules. Switch to a Playwright-based test type to run browser or API scripts.',
    );
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  if (isMissingEntrypoint(jsCode)) {
    errors.push('Script must export a default function or configure options.scenarios with named exec functions.');
  }

  errors.push(...findOptionLimitErrors(jsCode));

  // Warning: Recommend options export for test configuration
  // Use original script - esbuild restructures exports
  if (!/export\s+const\s+options\s*=/.test(script)) {
    warnings.push(
      'Consider adding "export const options" to configure VUs, duration, and thresholds',
    );
  }

  // Error: Block Node.js modules (k6 doesn't support them)
  const forbiddenModules = [
    'fs',
    'path',
    'child_process',
    'net',
    'http',
    'https',
    'crypto',
    'os',
    'process',
    'buffer',
  ];

  const importedModules = collectModuleSpecifiers(jsCode);

  forbiddenModules.forEach((mod) => {
    if (importedModules.has(mod) || importedModules.has(`node:${mod}`)) {
      errors.push(
        `k6 does not support Node.js module "${mod}". Use k6 built-in modules instead.`,
      );
    }
  });

  if (
    importedModules.has('@playwright/test') ||
    importedModules.has('playwright') ||
    importedModules.has('playwright/test')
  ) {
    errors.push(
      'Playwright modules are not supported in k6 performance scripts. Split Playwright tests into a Browser test.',
    );
  }

  if (hasUnboundHelperCall(jsCode, 'readFile')) {
    errors.push(
      "k6 does not support readFile(). Use open(getFile('KEY')) in init context, and wrap shared datasets in SharedArray when multiple VUs reuse them.",
    );
  }

  // Warning: Check for console.log usage (recommend using check() instead)
  if (/console\.log/.test(jsCode)) {
    warnings.push(
      'Consider using k6 check() functions instead of console.log() for validation',
    );
  }

  // Warning: Check if thresholds are defined
  // Use original script for export pattern (esbuild restructures exports)
  // Use jsCode for thresholds property check (esbuild preserves object literals)
  if (
    /export\s+const\s+options\s*=/.test(script) &&
    !/thresholds\s*:\s*\{/.test(jsCode)
  ) {
    warnings.push(
      'Consider adding thresholds to define pass/fail criteria for your test',
    );
  }

  // Error: Block experimental browser module which is unsupported in our runtime
  if (importedModules.has('k6/browser')) {
    errors.push(
      'The k6/browser module is not supported. Use Playwright tests for browser automation.',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get k6 script template with best practices
 */
export function getK6ScriptTemplate(): string {
  return `import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration - all settings in script
export const options = {
  vus: 10,              // 10 virtual users
  duration: '30s',      // Run for 30 seconds

  // Pass/fail criteria
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.1'],     // Error rate < 10%
  },
};

export default function() {
  // Test logic
  const response = http.get('https://test-api.k6.io/public/crocodiles/');

  // Validation checks
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}`;
}
