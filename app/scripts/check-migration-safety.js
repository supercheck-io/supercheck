#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DESTRUCTIVE_PATTERNS = [
  {
    name: "DROP TABLE",
    expression: /\bDROP\s+TABLE\b/giu,
  },
  {
    name: "DROP COLUMN",
    expression: /\bDROP\s+COLUMN\b/giu,
  },
  {
    name: "DROP TYPE",
    expression: /\bDROP\s+TYPE\b/giu,
  },
  {
    name: "DROP INDEX",
    expression: /\bDROP\s+INDEX\b/giu,
  },
  {
    name: "DROP SCHEMA",
    expression: /\bDROP\s+SCHEMA\b/giu,
  },
  {
    name: "DROP MATERIALIZED VIEW",
    expression: /\bDROP\s+MATERIALIZED\s+VIEW\b/giu,
  },
  {
    name: "DROP VIEW",
    expression: /\bDROP\s+VIEW\b/giu,
  },
  {
    name: "TRUNCATE",
    expression: /\bTRUNCATE(?:\s+TABLE)?\b/giu,
  },
  {
    name: "DROP CONSTRAINT",
    expression: /\bALTER\s+TABLE\b[^;]*?\bDROP\s+CONSTRAINT\b/giu,
  },
  {
    name: "RENAME TABLE OR COLUMN",
    expression: /\bALTER\s+TABLE\b[^;]*?\bRENAME\s+(?:COLUMN\s+)?(?:[^;\s]+\s+)?TO\b/giu,
  },
  {
    name: "SET NOT NULL",
    expression:
      /\bALTER\s+TABLE\b[^;]*?\bALTER\s+(?:COLUMN\s+)?[^;]*?\bSET\s+NOT\s+NULL\b/giu,
  },
  {
    name: "ALTER COLUMN TYPE",
    expression:
      /\bALTER\s+TABLE\b[^;]*?\bALTER\s+(?:COLUMN\s+)?[^;]*?\bTYPE\b/giu,
  },
];

const EXCEPTION_PATTERN =
  /--\s*migration-safety:\s*allow-destructive\s+issue=(?:#\d+|https:\/\/github\.com\/supercheck-io\/supercheck\/issues\/\d+)\s*$/imu;

// keepLiterals blanks comments only, so the text of strings stays searchable (set_config() names its
// setting in a string). keepDollarBodies keeps the code inside $$...$$ (a DO block) but still blanks
// the comments and strings within it, so statements there can be told apart from message text.
function maskSqlLiteralsAndComments(sql, { keepLiterals = false, keepDollarBodies = false } = {}) {
  let masked = "";
  let index = 0;
  let state = "sql";
  let blockCommentDepth = 0;
  let dollarQuoteDelimiter = "";
  let dollarBodyStart = 0;
  let singleQuoteBackslashEscapes = false;

  const appendMasked = (character) => {
    masked += character === "\r" || character === "\n" ? character : " ";
  };
  const appendLiteral = (character) => {
    if (keepLiterals) masked += character;
    else appendMasked(character);
  };

  while (index < sql.length) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (state === "sql") {
      if (character === "-" && nextCharacter === "-") {
        appendMasked(character);
        appendMasked(nextCharacter);
        index += 2;
        state = "line-comment";
        continue;
      }
      if (character === "/" && nextCharacter === "*") {
        appendMasked(character);
        appendMasked(nextCharacter);
        index += 2;
        blockCommentDepth = 1;
        state = "block-comment";
        continue;
      }
      if (character === "'") {
        const prefix = sql[index - 1];
        const beforePrefix = sql[index - 2];
        singleQuoteBackslashEscapes =
          (prefix === "E" || prefix === "e") &&
          (beforePrefix === undefined || !/[A-Za-z0-9_$]/u.test(beforePrefix));
        appendLiteral(character);
        index += 1;
        state = "single-quote";
        continue;
      }
      if (character === '"') {
        appendLiteral(character);
        index += 1;
        state = "double-quote";
        continue;
      }
      if (character === "$") {
        const delimiterMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(index));
        if (delimiterMatch) {
          dollarQuoteDelimiter = delimiterMatch[0];
          for (const delimiterCharacter of dollarQuoteDelimiter) {
            appendLiteral(delimiterCharacter);
          }
          index += dollarQuoteDelimiter.length;
          dollarBodyStart = index;
          state = "dollar-quote";
          continue;
        }
      }

      masked += character;
      index += 1;
      continue;
    }

    if (state === "line-comment") {
      appendMasked(character);
      index += 1;
      if (character === "\n") state = "sql";
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && nextCharacter === "*") {
        appendMasked(character);
        appendMasked(nextCharacter);
        index += 2;
        blockCommentDepth += 1;
        continue;
      }
      if (character === "*" && nextCharacter === "/") {
        appendMasked(character);
        appendMasked(nextCharacter);
        index += 2;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) state = "sql";
        continue;
      }
      appendMasked(character);
      index += 1;
      continue;
    }

    if (state === "single-quote") {
      appendLiteral(character);
      index += 1;
      if (singleQuoteBackslashEscapes && character === "\\" && nextCharacter !== undefined) {
        appendLiteral(nextCharacter);
        index += 1;
      } else if (character === "'" && nextCharacter === "'") {
        appendLiteral(nextCharacter);
        index += 1;
      } else if (character === "'") {
        singleQuoteBackslashEscapes = false;
        state = "sql";
      }
      continue;
    }

    if (state === "double-quote") {
      appendLiteral(character);
      index += 1;
      if (character === '"' && nextCharacter === '"') {
        appendLiteral(nextCharacter);
        index += 1;
      } else if (character === '"') {
        state = "sql";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (sql.startsWith(dollarQuoteDelimiter, index)) {
        if (keepDollarBodies) {
          masked += maskSqlLiteralsAndComments(sql.slice(dollarBodyStart, index), { keepDollarBodies });
        }
        for (const delimiterCharacter of dollarQuoteDelimiter) {
          appendLiteral(delimiterCharacter);
        }
        index += dollarQuoteDelimiter.length;
        dollarQuoteDelimiter = "";
        state = "sql";
      } else {
        if (!keepDollarBodies) appendLiteral(character);
        index += 1;
      }
    }
  }

  if (state !== "sql" && state !== "line-comment") {
    throw new SyntaxError(`Unterminated SQL ${state.replace("-", " ")}`);
  }

  return masked;
}

function statementRanges(maskedSql) {
  const ranges = [];
  let start = 0;

  for (let index = 0; index < maskedSql.length; index += 1) {
    if (maskedSql[index] === ";") {
      ranges.push({ start, end: index + 1 });
      start = index + 1;
    }
  }

  if (start < maskedSql.length) {
    ranges.push({ start, end: maskedSql.length });
  }

  return ranges;
}

function clauseEnd(statement, start) {
  let parenthesisDepth = 0;

  for (let index = start; index < statement.length; index += 1) {
    if (statement[index] === "(") {
      parenthesisDepth += 1;
    } else if (statement[index] === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    } else if (statement[index] === "," && parenthesisDepth === 0) {
      return index;
    }
  }

  return statement.length;
}

function hasTrackedException(sql, statementStart, operationIndex) {
  return EXCEPTION_PATTERN.test(sql.slice(statementStart, operationIndex));
}

function findUnsafeStatements(sql) {
  const maskedSql = maskSqlLiteralsAndComments(sql);
  const findings = [];

  const timeoutChanges = /\b(?:SET\s+LOCAL\s+(lock_timeout|statement_timeout)|RESET\s+(lock_timeout|statement_timeout|ALL))\b/giu;
  const pendingTimeouts = new Map();
  for (const match of maskedSql.matchAll(timeoutChanges)) {
    if (match[1]) {
      const setting = match[1].toLowerCase();
      if (!pendingTimeouts.has(setting)) pendingTimeouts.set(setting, match.index);
    } else if (match[2].toLowerCase() === "all") {
      pendingTimeouts.clear();
    } else {
      pendingTimeouts.delete(match[2].toLowerCase());
    }
  }
  // A timeout set for the whole session survives the transaction-local restore, so it must be
  // transaction-local. These changes also hide inside DO blocks and EXECUTE strings.
  const sessionFindings = [];
  const bodies = maskSqlLiteralsAndComments(sql, { keepDollarBodies: true });
  const setStatement = /(?:^|;|\bBEGIN\b|\bTHEN\b|\bELSE\b|\bLOOP\b)\s*(SET\s+(?:SESSION\s+)?(lock_timeout|statement_timeout)\b)/giu;
  for (const match of bodies.matchAll(setStatement)) {
    sessionFindings.push({ setting: match[2], index: match.index + match[0].indexOf(match[1]) });
  }
  const withStrings = maskSqlLiteralsAndComments(sql, { keepLiterals: true });
  for (const match of withStrings.matchAll(/\bEXECUTE\s+'[^']*?\bSET\s+(?:SESSION\s+)?(lock_timeout|statement_timeout)\b/giu)) {
    sessionFindings.push({ setting: match[1], index: match.index });
  }
  // set_config(name, value, is_local): flag is_local = false. Locate calls where code is (not in message
  // text), then read the arguments, which may nest calls, from the text that still has its strings.
  for (const call of bodies.matchAll(/\bset_config\s*\(/giu)) {
    const open = call.index + call[0].length;
    const args = [];
    let depth = 0;
    let quoted = false;
    let start = open;
    for (let at = open; at < withStrings.length && args.length < 3; at += 1) {
      const character = withStrings[at];
      if (quoted) { if (character === "'") quoted = false; continue; }
      if (character === "'") quoted = true;
      else if (character === "(") depth += 1;
      else if (character === ")" && depth === 0) { args.push(withStrings.slice(start, at)); break; }
      else if (character === ")") depth -= 1;
      else if (character === "," && depth === 0) { args.push(withStrings.slice(start, at)); start = at + 1; }
    }
    const setting = /^\s*'(lock_timeout|statement_timeout)'\s*$/iu.exec(args[0] ?? "");
    if (setting && /^\s*(?:false|'f'|'false'|0)\s*$/iu.test(args[2] ?? "")) {
      sessionFindings.push({ setting: setting[1], index: call.index });
    }
  }
  for (const { setting, index } of sessionFindings) {
    findings.push({
      operation: `session-level ${setting.toLowerCase()} change (use SET LOCAL or set_config(..., true))`,
      line: sql.slice(0, index).split(/\r?\n/u).length,
    });
  }
  for (const [setting, index] of pendingTimeouts) {
    findings.push({
      operation: `SET LOCAL ${setting} without RESET`,
      line: sql.slice(0, index).split(/\r?\n/u).length,
    });
  }

  for (const { name, expression } of DESTRUCTIVE_PATTERNS) {
    expression.lastIndex = 0;
    for (const match of maskedSql.matchAll(expression)) {
      const statementStart = maskedSql.lastIndexOf(";", match.index) + 1;
      if (hasTrackedException(sql, statementStart, match.index)) {
        continue;
      }

      findings.push({
        operation: name,
        line: sql.slice(0, match.index).split(/\r?\n/u).length,
      });
    }
  }

  for (const { start, end } of statementRanges(maskedSql)) {
    const statement = maskedSql.slice(start, end);

    const deleteMatch = /\bDELETE\s+FROM\b/iu.exec(statement);
    if (deleteMatch) {
      const deleteIndex = start + deleteMatch.index;
      const deleteClause = statement.slice(deleteMatch.index);
      if (!/\bWHERE\b/iu.test(deleteClause) && !hasTrackedException(sql, start, deleteIndex)) {
        findings.push({
          operation: "DELETE FROM without WHERE",
          line: sql.slice(0, deleteIndex).split(/\r?\n/u).length,
        });
      }
    }

    const addColumnExpression =
      /\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?!(?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b)/giu;
    for (const addColumnMatch of statement.matchAll(addColumnExpression)) {
      const columnClause = statement.slice(
        addColumnMatch.index,
        clauseEnd(statement, addColumnMatch.index),
      );
      const operationIndex = start + addColumnMatch.index;
      if (
        /\bNOT\s+NULL\b/iu.test(columnClause) &&
        !/\bDEFAULT\b/iu.test(columnClause) &&
        !hasTrackedException(sql, start, operationIndex)
      ) {
        findings.push({
          operation: "ADD COLUMN NOT NULL without DEFAULT",
          line: sql.slice(0, operationIndex).split(/\r?\n/u).length,
        });
      }
    }
  }

  return findings.sort((left, right) => left.line - right.line);
}

function checkFiles(files) {
  const violations = [];

  for (const file of files) {
    if (!file.endsWith(".sql")) {
      throw new Error(`Expected a SQL migration file, received: ${file}`);
    }

    const sql = fs.readFileSync(file, "utf8");
    for (const finding of findUnsafeStatements(sql)) {
      violations.push({ file, ...finding });
    }
  }

  return violations;
}

function main(argv) {
  if (argv.length === 0) {
    console.error("Usage: node scripts/check-migration-safety.js <migration.sql> [...]");
    return 2;
  }

  const violations = checkFiles(argv);
  if (violations.length === 0) {
    console.log(`Migration safety check passed for ${argv.length} file(s).`);
    return 0;
  }

  console.error("Unsafe database migration operations are not allowed by default:");
  for (const violation of violations) {
    console.error(`- ${path.relative(process.cwd(), violation.file)}:${violation.line} ${violation.operation}`);
  }
  console.error(
    "Restore timeout settings before the migration ends. Use an expand/contract migration for schema changes. For an intentional cleanup phase, add " +
      '"-- migration-safety: allow-destructive issue=#123" immediately before the statement.',
  );
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

module.exports = { checkFiles, findUnsafeStatements, maskSqlLiteralsAndComments };
