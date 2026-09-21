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

function maskSqlLiteralsAndComments(sql) {
  let masked = "";
  let index = 0;
  let state = "sql";
  let blockCommentDepth = 0;
  let dollarQuoteDelimiter = "";
  let singleQuoteBackslashEscapes = false;

  const appendMasked = (character) => {
    masked += character === "\r" || character === "\n" ? character : " ";
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
        appendMasked(character);
        index += 1;
        state = "single-quote";
        continue;
      }
      if (character === '"') {
        appendMasked(character);
        index += 1;
        state = "double-quote";
        continue;
      }
      if (character === "$") {
        const delimiterMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(index));
        if (delimiterMatch) {
          dollarQuoteDelimiter = delimiterMatch[0];
          for (const delimiterCharacter of dollarQuoteDelimiter) {
            appendMasked(delimiterCharacter);
          }
          index += dollarQuoteDelimiter.length;
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
      appendMasked(character);
      index += 1;
      if (singleQuoteBackslashEscapes && character === "\\" && nextCharacter !== undefined) {
        appendMasked(nextCharacter);
        index += 1;
      } else if (character === "'" && nextCharacter === "'") {
        appendMasked(nextCharacter);
        index += 1;
      } else if (character === "'") {
        singleQuoteBackslashEscapes = false;
        state = "sql";
      }
      continue;
    }

    if (state === "double-quote") {
      appendMasked(character);
      index += 1;
      if (character === '"' && nextCharacter === '"') {
        appendMasked(nextCharacter);
        index += 1;
      } else if (character === '"') {
        state = "sql";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (sql.startsWith(dollarQuoteDelimiter, index)) {
        for (const delimiterCharacter of dollarQuoteDelimiter) {
          appendMasked(delimiterCharacter);
        }
        index += dollarQuoteDelimiter.length;
        dollarQuoteDelimiter = "";
        state = "sql";
      } else {
        appendMasked(character);
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

  console.error("Destructive database migration operations are not allowed by default:");
  for (const violation of violations) {
    console.error(`- ${path.relative(process.cwd(), violation.file)}:${violation.line} ${violation.operation}`);
  }
  console.error(
    "Use an expand/contract migration. For an intentional cleanup phase, add " +
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
