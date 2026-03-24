import { db } from "@/utils/db";
import { projectVariables } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptValue } from "@/lib/encryption";

export interface ResolvedVariable {
  key: string;
  value: string;
}

export interface FileVariableMetadata {
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface VariableResolutionResult {
  variables: Record<string, string>;
  secrets: Record<string, string>;
  files: Record<string, FileVariableMetadata>;
  errors?: string[];
}

/**
 * Resolve all variables for a project
 * This function should be called server-side during job/test creation
 */
export async function resolveProjectVariables(
  projectId: string
): Promise<VariableResolutionResult> {
  try {
    // Fetch all variables for the project
    const variables = await db
      .select()
      .from(projectVariables)
      .where(eq(projectVariables.projectId, projectId));

    const resolvedVariables: Record<string, string> = {};
    const resolvedSecrets: Record<string, string> = {};
    const resolvedFiles: Record<string, FileVariableMetadata> = {};
    const errors: string[] = [];

    for (const variable of variables) {
      try {
        const varType = variable.type || (variable.isSecret ? 'secret' : 'variable');

        if (varType === 'file') {
          if (variable.storagePath && variable.fileName) {
            resolvedFiles[variable.key] = {
              storagePath: variable.storagePath,
              fileName: variable.fileName,
              mimeType: variable.mimeType || 'application/octet-stream',
              fileSize: variable.fileSize || 0,
            };
          } else {
            errors.push(
              `File variable '${variable.key}' is missing storage path or file name`
            );
          }
          continue;
        }

        let value: string;

        if (variable.isSecret) {
          // Decrypt secret variables
          if (variable.encryptedValue) {
            value = decryptValue(variable.encryptedValue, projectId);
            resolvedSecrets[variable.key] = value;
          } else {
            errors.push(
              `Secret variable '${variable.key}' has no encrypted value`
            );
            continue;
          }
        } else {
          // Use plain text value for non-secret variables
          value = variable.value;
          resolvedVariables[variable.key] = value;
        }
      } catch (error) {
        console.error(`Failed to resolve variable '${variable.key}':`, error);
        errors.push(
          `Failed to resolve variable '${variable.key}': ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    console.log(
      `Resolved ${Object.keys(resolvedVariables).length} variables, ${
        Object.keys(resolvedSecrets).length
      } secrets, and ${Object.keys(resolvedFiles).length} files for project ${projectId}`
    );

    return {
      variables: resolvedVariables,
      secrets: resolvedSecrets,
      files: resolvedFiles,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error(
      `Failed to resolve variables for project ${projectId}:`,
      error
    );
    return {
      variables: {},
      secrets: {},
      files: {},
      errors: [
        `Failed to resolve variables: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
}

/**
 * Parse script to find variable helper calls and extract variable names.
 * This is used for validation and optimization
 */
export function extractVariableNames(script: string): string[] {
  const variableNames: string[] = [];

  // Match standalone helper calls only, not methods like fs.readFile().
  const regex =
    /(?<![.\w])(?:getVariable|getSecret|getFile|readFile)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match;

  while ((match = regex.exec(script)) !== null) {
    const variableName = match[1];
    if (!variableNames.includes(variableName)) {
      variableNames.push(variableName);
    }
  }

  return variableNames;
}

/**
 * Generate getVariable, getSecret, and getFile function implementations for test execution
 */
export function generateVariableFunctions(
  variables: Record<string, string>,
  secrets: Record<string, string>,
  files?: Record<string, string>, // key -> file path in container
): string {
  // Use JSON.stringify for both keys and values to prevent injection attacks
  // JSON.stringify properly escapes backslashes, quotes, and control characters
  const variableEntries = Object.entries(variables)
    .map(
      ([key, value]) => {
        const safeKey = JSON.stringify(key);
        const safeValue = JSON.stringify(value);
        return `${safeKey}: ${safeValue}`;
      }
    )
    .join(", ");

  const secretEntries = Object.entries(secrets)
    .map(
      ([key, value]) => {
        const safeKey = JSON.stringify(key);
        const safeValue = JSON.stringify(value);
        return `${safeKey}: ${safeValue}`;
      }
    )
    .join(", ");

  const fileEntries = files
    ? Object.entries(files)
        .map(([key, path]) => {
          const safeKey = JSON.stringify(key);
          const safePath = JSON.stringify(path);
          return `${safeKey}: ${safePath}`;
        })
        .join(", ")
    : "";

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

function getSecret(key, options = {}) {
  const secrets = {${secretEntries}};
  
  const value = secrets[key];
  
  if (value === undefined) {
    if (options.required) {
      throw new Error(\`Required secret '\${key}' is not defined\`);
    }
    return options.default !== undefined ? options.default : '';
  }
  
  // Handle type conversion
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
      default:
        return value;
    }
  }
  
  // Return the actual string value directly
  // This allows secrets to work with template literals, HTTP headers, form fills, etc.
  // Security note: secrets are already embedded in the script at execution time,
  // so returning the raw value doesn't introduce additional exposure
  return value;
}

function getFile(key) {
  const files = {${fileEntries}};
  
  const filePath = files[key];
  
  if (filePath === undefined) {
    throw new Error(\`File variable '\${key}' is not defined. Make sure you have created a file-type variable with this key.\`);
  }
  
  return filePath;
}

function readFile(key, encoding) {
  const files = {${fileEntries}};
  
  const filePath = files[key];
  
  if (filePath === undefined) {
    throw new Error(\`File variable '\${key}' is not defined. Make sure you have created a file-type variable with this key.\`);
  }
  
  const fs = require('fs');
  return fs.readFileSync(filePath, encoding || 'utf-8');
}
`;
}

/**
 * @deprecated Use generateVariableFunctions instead
 * Generate the getVariable function implementation for test execution
 */
export function generateGetVariableFunction(
  variables: Record<string, string>
): string {
  return generateVariableFunctions(variables, {});
}
