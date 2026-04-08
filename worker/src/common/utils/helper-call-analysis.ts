/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
/**
 * AST-based helper call analysis.
 *
 * SYNC: The scope analysis core (types through collectUnboundHelperCalls) is
 * shared with app/src/lib/helper-call-analysis.ts.
 * When modifying the shared internals keep both files in sync.
 */
// Acorn exposes a structurally typed ESTree AST; this helper intentionally
// walks dynamic node shapes while keeping the rest of the worker lint-clean.
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export type HelperName = 'getFile' | 'readFile';

export interface HelperCall {
  name: HelperName;
  literalKey?: string;
}

type ScopeKind = 'program' | 'function' | 'block';

interface Scope {
  kind: ScopeKind;
  parent: Scope | null;
  bindings: Set<string>;
}

function createScope(kind: ScopeKind, parent: Scope | null): Scope {
  return {
    kind,
    parent,
    bindings: new Set<string>(),
  };
}

function nearestFunctionScope(scope: Scope): Scope {
  let current: Scope = scope;
  while (current.parent && current.kind === 'block') {
    current = current.parent;
  }
  return current;
}

function addPatternBindings(pattern: any, scope: Scope): void {
  if (!pattern) {
    return;
  }

  switch (pattern.type) {
    case 'Identifier':
      scope.bindings.add(pattern.name);
      break;
    case 'RestElement':
      addPatternBindings(pattern.argument, scope);
      break;
    case 'AssignmentPattern':
      addPatternBindings(pattern.left, scope);
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements ?? []) {
        addPatternBindings(element, scope);
      }
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties ?? []) {
        if (property.type === 'RestElement') {
          addPatternBindings(property.argument, scope);
        } else if (property.type === 'Property') {
          addPatternBindings(property.value, scope);
        }
      }
      break;
  }
}

function visitDefaultValues(
  pattern: any,
  scope: Scope,
  visit: (node: any, scope: Scope) => void,
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'AssignmentPattern':
      if (pattern.right) visit(pattern.right, scope);
      visitDefaultValues(pattern.left, scope, visit);
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements ?? []) {
        visitDefaultValues(element, scope, visit);
      }
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties ?? []) {
        if (property.type === 'RestElement') {
          visitDefaultValues(property.argument, scope, visit);
        } else if (property.type === 'Property') {
          visitDefaultValues(property.value, scope, visit);
        }
      }
      break;
    case 'RestElement':
      visitDefaultValues(pattern.argument, scope, visit);
      break;
  }
}

function recurseChildren(
  node: any,
  scope: Scope,
  visit: (child: any, scope: Scope) => void,
): void {
  const base = (
    walk.base as Record<
      string,
      (
        node: any,
        state: Scope,
        callback: (child: any, state?: Scope) => void,
      ) => void
    >
  )[node.type];

  if (!base) {
    return;
  }

  base(node, scope, (child: any, childScope?: Scope) => {
    visit(child, childScope ?? scope);
  });
}

function buildScopeMap(ast: acorn.Node): WeakMap<acorn.Node, Scope> {
  const scopeMap = new WeakMap<acorn.Node, Scope>();

  const visit = (node: any, scope: Scope): void => {
    switch (node.type) {
      case 'Program':
        scopeMap.set(node, scope);
        for (const statement of node.body) {
          visit(statement, scope);
        }
        return;

      case 'BlockStatement': {
        const blockScope = createScope('block', scope);
        scopeMap.set(node, blockScope);
        for (const statement of node.body) {
          visit(statement, blockScope);
        }
        return;
      }

      case 'FunctionDeclaration': {
        if (node.id?.name) {
          scope.bindings.add(node.id.name);
        }

        const functionScope = createScope('function', scope);
        scopeMap.set(node, functionScope);

        if (node.id?.name) {
          functionScope.bindings.add(node.id.name);
        }

        for (const parameter of node.params ?? []) {
          addPatternBindings(parameter, functionScope);
        }

        for (const parameter of node.params ?? []) {
          visitDefaultValues(parameter, functionScope, visit);
        }

        visit(node.body, functionScope);
        return;
      }

      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const functionScope = createScope('function', scope);
        scopeMap.set(node, functionScope);

        if (node.type === 'FunctionExpression' && node.id?.name) {
          functionScope.bindings.add(node.id.name);
        }

        for (const parameter of node.params ?? []) {
          addPatternBindings(parameter, functionScope);
        }

        for (const parameter of node.params ?? []) {
          visitDefaultValues(parameter, functionScope, visit);
        }

        visit(node.body, functionScope);
        return;
      }

      case 'CatchClause': {
        const catchScope = createScope('block', scope);
        scopeMap.set(node, catchScope);
        addPatternBindings(node.param, catchScope);
        visit(node.body, catchScope);
        return;
      }

      case 'ImportDeclaration':
        for (const specifier of node.specifiers ?? []) {
          if (specifier.local?.name) {
            scope.bindings.add(specifier.local.name);
          }
        }
        return;

      case 'VariableDeclaration': {
        const targetScope =
          node.kind === 'var' ? nearestFunctionScope(scope) : scope;

        for (const declaration of node.declarations ?? []) {
          addPatternBindings(declaration.id, targetScope);
        }

        recurseChildren(node, scope, visit);
        return;
      }

      case 'ClassDeclaration':
        if (node.id?.name) {
          scope.bindings.add(node.id.name);
        }
        recurseChildren(node, scope, visit);
        return;

      case 'ForStatement': {
        const loopScope = createScope('block', scope);
        scopeMap.set(node, loopScope);
        if (node.init) visit(node.init, loopScope);
        if (node.test) visit(node.test, loopScope);
        if (node.update) visit(node.update, loopScope);
        if (node.body) visit(node.body, loopScope);
        return;
      }

      case 'ForInStatement':
      case 'ForOfStatement': {
        const loopScope = createScope('block', scope);
        scopeMap.set(node, loopScope);
        if (node.left) visit(node.left, loopScope);
        if (node.right) visit(node.right, scope);
        if (node.body) visit(node.body, loopScope);
        return;
      }

      default:
        recurseChildren(node, scope, visit);
    }
  };

  const programScope = createScope('program', null);
  visit(ast as any, programScope);
  return scopeMap;
}

function isBound(scope: Scope, identifier: string): boolean {
  let current: Scope | null = scope;

  while (current) {
    if (current.bindings.has(identifier)) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function extractLiteralKey(argument: any): string | undefined {
  if (!argument) {
    return undefined;
  }

  if (argument.type === 'Literal' && typeof argument.value === 'string') {
    return argument.value;
  }

  if (
    argument.type === 'TemplateLiteral' &&
    argument.expressions?.length === 0 &&
    argument.quasis?.length === 1
  ) {
    return argument.quasis[0].value?.cooked;
  }

  return undefined;
}

function collectHelperCallsWithAst(
  script: string,
  helperNames: readonly HelperName[],
): HelperCall[] {
  const ast = acorn.parse(script, {
    ecmaVersion: 2022,
    sourceType: 'module',
  }) as acorn.Node;
  const helperNameSet = new Set(helperNames);
  const scopeMap = buildScopeMap(ast);
  const calls: HelperCall[] = [];

  const visit = (node: any, scope: Scope): void => {
    switch (node.type) {
      case 'Program': {
        const programScope = scopeMap.get(node) ?? scope;
        for (const statement of node.body) {
          visit(statement, programScope);
        }
        return;
      }

      case 'BlockStatement': {
        const blockScope = scopeMap.get(node) ?? scope;
        for (const statement of node.body) {
          visit(statement, blockScope);
        }
        return;
      }

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const functionScope = scopeMap.get(node) ?? scope;
        for (const param of node.params ?? []) {
          visitDefaultValues(param, functionScope, visit);
        }
        visit(node.body, functionScope);
        return;
      }

      case 'CatchClause': {
        const catchScope = scopeMap.get(node) ?? scope;
        visit(node.body, catchScope);
        return;
      }

      case 'CallExpression':
        if (
          node.callee?.type === 'Identifier' &&
          helperNameSet.has(node.callee.name) &&
          !isBound(scope, node.callee.name)
        ) {
          calls.push({
            name: node.callee.name,
            literalKey: extractLiteralKey(node.arguments?.[0]),
          });
        } else if (
          node.callee?.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.object?.type === 'Identifier' &&
          node.callee.object.name === 'globalThis' &&
          node.callee.property?.type === 'Identifier' &&
          helperNameSet.has(node.callee.property.name)
        ) {
          calls.push({
            name: node.callee.property.name,
            literalKey: extractLiteralKey(node.arguments?.[0]),
          });
        }
        recurseChildren(node, scope, visit);
        return;

      case 'ForStatement': {
        const loopScope = scopeMap.get(node) ?? scope;
        if (node.init) visit(node.init, loopScope);
        if (node.test) visit(node.test, loopScope);
        if (node.update) visit(node.update, loopScope);
        if (node.body) visit(node.body, loopScope);
        return;
      }

      case 'ForInStatement':
      case 'ForOfStatement': {
        const loopScope = scopeMap.get(node) ?? scope;
        if (node.left) visit(node.left, loopScope);
        if (node.right) visit(node.right, scope);
        if (node.body) visit(node.body, loopScope);
        return;
      }

      default:
        recurseChildren(node, scope, visit);
    }
  };

  const programScope = scopeMap.get(ast);
  if (!programScope) {
    return [];
  }

  visit(ast as any, programScope);
  return calls;
}

function hasLikelyLocalBinding(script: string, helperName: string): boolean {
  const escapedName = helperName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Only suppress for imports (always top-level in ESM).  Function/variable
  // declarations may be in nested scopes, so suppressing globally would hide
  // legitimate helper calls outside those scopes.
  const patterns = [
    new RegExp(String.raw`\bimport\s+${escapedName}\b`),
    new RegExp(
      String.raw`\bimport\s+\{[^}]*\b${escapedName}\b[^}]*\}\s+from\b`,
    ),
  ];

  return patterns.some((pattern) => pattern.test(script));
}

function collectHelperCallsWithRegex(
  script: string,
  helperNames: readonly HelperName[],
): HelperCall[] {
  const calls: HelperCall[] = [];

  for (const helperName of helperNames) {
    const escapedName = helperName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // globalThis.helperName(...) always refers to the runtime helper
    // regardless of any local bindings, so collect these unconditionally.
    const globalThisPattern = new RegExp(
      'globalThis\\.' +
        escapedName +
        '\\s*\\(\\s*(?:[\'"`]([^\'"`]+)[\'"`])?',
      'g',
    );

    let match: RegExpExecArray | null = null;
    while ((match = globalThisPattern.exec(script)) !== null) {
      calls.push({
        name: helperName,
        literalKey: match[1],
      });
    }

    // For bare helperName(...) calls, suppress only when an import binding
    // exists (imports are always top-level in ESM).
    if (hasLikelyLocalBinding(script, helperName)) {
      continue;
    }

    const barePattern = new RegExp(
      '(?<![.\\w])' + escapedName + '\\s*\\(\\s*(?:[\'"`]([^\'"`]+)[\'"`])?',
      'g',
    );

    match = null;
    while ((match = barePattern.exec(script)) !== null) {
      calls.push({
        name: helperName,
        literalKey: match[1],
      });
    }
  }

  return calls;
}

export function collectUnboundHelperCalls(
  script: string,
  helperNames: readonly HelperName[] = ['getFile', 'readFile'],
): HelperCall[] {
  try {
    return collectHelperCallsWithAst(script, helperNames);
  } catch {
    return collectHelperCallsWithRegex(script, helperNames);
  }
}
