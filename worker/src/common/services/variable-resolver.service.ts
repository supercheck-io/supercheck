/**
 * Variable Resolver Service
 *
 * Provides secure variable and secret resolution for synthetic monitor execution.
 * Mirrors the logic from app/src/lib/variable-resolver.ts for DRY consistency.
 *
 * Security Considerations:
 * - Secrets are decrypted in-memory only when needed
 * - Secrets are never logged or exposed in error messages
 * - Project-scoped encryption ensures cross-project isolation
 */

import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { decryptSecret, type SecretEnvelope } from '../security/secret-crypto';

// Encrypted value format used by the app
const ENCRYPTED_PREFIX = 'enc:v1:';

export interface VariableResolutionResult {
  variables: Record<string, string>;
  secrets: Record<string, string>;
  errors?: string[];
}

/**
 * Decodes the encrypted envelope from the serialized format
 */
function decodeEnvelope(serialized: string): SecretEnvelope {
  const payload = serialized.slice(ENCRYPTED_PREFIX.length);
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json) as SecretEnvelope;
}

/**
 * Decrypts a value that was encrypted by the app's encryptValue function
 * @param encryptedValue The encrypted value string (starting with enc:v1:)
 * @param projectId The project ID used as encryption context
 */
function decryptValue(encryptedValue: string, projectId: string): string {
  if (!encryptedValue.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error('Unsupported encrypted value format');
  }

  const envelope = decodeEnvelope(encryptedValue);
  return decryptSecret(envelope, { context: projectId });
}

@Injectable()
export class VariableResolverService {
  private readonly logger = new Logger(VariableResolverService.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Resolve all variables for a project
   * This method fetches variables from the database and decrypts secrets securely
   *
   * @param projectId The project ID to resolve variables for
   * @returns Object containing resolved variables and secrets
   */
  async resolveProjectVariables(
    projectId: string,
  ): Promise<VariableResolutionResult> {
    try {
      // Fetch all variables for the project
      const variables = await this.dbService.getProjectVariables(projectId);

      const resolvedVariables: Record<string, string> = {};
      const resolvedSecrets: Record<string, string> = {};
      const errors: string[] = [];

      for (const variable of variables) {
        try {
          if (variable.isSecret) {
            // Decrypt secret variables
            if (variable.encryptedValue) {
              const value = decryptValue(variable.encryptedValue, projectId);
              resolvedSecrets[variable.key] = value;
            } else {
              errors.push(
                `Secret variable '${variable.key}' has no encrypted value`,
              );
            }
          } else {
            // Use plain text value for non-secret variables
            resolvedVariables[variable.key] = variable.value;
          }
        } catch (error) {
          // Log error without exposing secret details
          this.logger.error(
            `Failed to resolve variable '${variable.key}': ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          errors.push(`Failed to resolve variable '${variable.key}'`);
        }
      }

      this.logger.log(
        `Resolved ${Object.keys(resolvedVariables).length} variables and ${Object.keys(resolvedSecrets).length} secrets for project ${projectId}`,
      );

      return {
        variables: resolvedVariables,
        secrets: resolvedSecrets,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Failed to resolve variables for project ${projectId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return {
        variables: {},
        secrets: {},
        errors: [
          `Failed to resolve variables: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      };
    }
  }

  /**
   * Generate both getVariable and getSecret function implementations for test execution
   *
   * Security: This embeds resolved values into JavaScript code that runs in an isolated container.
   * The generated functions provide a type-safe API for accessing configuration values.
   *
   * @param variables Plain text configuration variables
   * @param secrets Decrypted secret values (handled securely in-memory)
   * @returns JavaScript code defining getVariable() and getSecret() functions
   */
  generateVariableFunctions(
    variables: Record<string, string>,
    secrets: Record<string, string>,
  ): string {
    // Use JSON.stringify for both keys and values to prevent injection attacks
    // JSON.stringify properly escapes backslashes, quotes, and control characters
    const variableEntries = Object.entries(variables)
      .map(([key, value]) => {
        const safeKey = JSON.stringify(key);
        const safeValue = JSON.stringify(value);
        return `${safeKey}: ${safeValue}`;
      })
      .join(', ');

    const secretEntries = Object.entries(secrets)
      .map(([key, value]) => {
        const safeKey = JSON.stringify(key);
        const safeValue = JSON.stringify(value);
        return `${safeKey}: ${safeValue}`;
      })
      .join(', ');

    return `
function getVariable(key, options = {}) {
  const variables = {${variableEntries}};
  
  const value = variables[key];
  
  if (value === undefined) {
    if (options.required) {
      throw new Error(\`Required variable '\${key}' is not defined\`);
    }
    return options.default !== undefined ? options.default : '';
  }
  
  // Handle type conversion
  if (options.type) {
    switch (options.type) {
      case 'number':
        const num = Number(value);
        if (isNaN(num)) {
          throw new Error(\`Variable '\${key}' cannot be converted to number: \${value}\`);
        }
        return num;
      case 'boolean':
        return value.toLowerCase() === 'true' || value === '1';
      case 'string':
      default:
        return value;
    }
  }
  
  return value;
}

// ProtectedString extends String so that:
// - instanceof String === true (Playwright's tString validator accepts it and extracts via valueOf())
// - toString() / Symbol.toPrimitive('string') return '[SECRET]' (masks in console.log, template literals, traces)
// - valueOf() returns the actual secret value (used by Playwright fill, setExtraHTTPHeaders, etc.)
// - toJSON() returns '[SECRET]' (masks in JSON.stringify)
class ProtectedString extends String {
  #v;
  constructor(val) {
    super('[SECRET]');
    this.#v = val;
  }
  valueOf() { return this.#v; }
  toString() { return '[SECRET]'; }
  toJSON() { return '[SECRET]'; }
  [Symbol.toPrimitive](hint) {
    if (hint === 'string') return '[SECRET]';
    return this.#v;
  }
  get [Symbol.toStringTag]() { return 'ProtectedSecret'; }
  // Node.js util.inspect custom symbol
  get [Symbol.for('nodejs.util.inspect.custom')]() {
    return () => '[SECRET]';
  }
}

function getSecret(key, options = {}) {
  const secrets = {${secretEntries}};
  
  const value = secrets[key];
  
  if (value === undefined) {
    if (options.required) {
      throw new Error(\`Required secret '\${key}' is not defined\`);
    }
    return options.default !== undefined ? options.default : '';
  }
  
  // Handle type conversion - returns raw values for explicit type requests
  if (options.type) {
    switch (options.type) {
      case 'number':
        const num = Number(value);
        if (isNaN(num)) {
          throw new Error(\`Secret '\${key}' cannot be converted to number\`);
        }
        return num;
      case 'boolean':
        return value.toLowerCase() === 'true' || value === '1';
      case 'string':
        return value;
      default:
        break;
    }
  }
  
  // Return a ProtectedString that:
  // - Works with Playwright fill(), goto(), setExtraHTTPHeaders() (via instanceof String + valueOf)
  // - Masks value in console.log, template literals, JSON.stringify (via toString/toPrimitive/toJSON)
  // - No .toString() call needed by users — just pass directly to Playwright APIs
  return new ProtectedString(value);
}
`;
  }
}
