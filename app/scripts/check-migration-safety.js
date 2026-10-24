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
// keepIdentifiers keeps the text of "double-quoted" identifiers (the quote marks become spaces), because
// SET "lock_timeout" names the same setting as SET lock_timeout. Every mask keeps the length of the input,
// so an index found in one mask is the same position in the others.
function maskSqlLiteralsAndComments(sql, { keepLiterals = false, keepDollarBodies = false, keepIdentifiers = false } = {}) {
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
  const appendIdentifier = (character) => {
    if (keepIdentifiers && !keepLiterals) masked += character === '"' ? " " : character;
    else appendLiteral(character);
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
        appendIdentifier(character);
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
      appendIdentifier(character);
      index += 1;
      if (character === '"' && nextCharacter === '"') {
        appendIdentifier(nextCharacter);
        index += 1;
      } else if (character === '"') {
        state = "sql";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (sql.startsWith(dollarQuoteDelimiter, index)) {
        if (keepDollarBodies) {
          masked += maskSqlLiteralsAndComments(sql.slice(dollarBodyStart, index), { keepDollarBodies, keepIdentifiers });
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
  const withIdentifiers = maskSqlLiteralsAndComments(sql, { keepIdentifiers: true });
  for (const match of withIdentifiers.matchAll(timeoutChanges)) {
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
  const bodies = maskSqlLiteralsAndComments(sql, { keepDollarBodies: true, keepIdentifiers: true });
  const setStatement = /(?:^|;|\bBEGIN\b|\bTHEN\b|\bELSE\b|\bLOOP\b)\s*(SET\s+(?:SESSION\s+)?(lock_timeout|statement_timeout)\b)/giu;
  for (const match of bodies.matchAll(setStatement)) {
    sessionFindings.push({ setting: match[2], index: match.index + match[0].indexOf(match[1]) });
  }
  const withStrings = maskSqlLiteralsAndComments(sql, { keepLiterals: true });
  // EXECUTE can build the statement any way it likes: E'..', $q$..$q$, 'SET ' || 'lock_timeout', format(). So look
  // at the whole EXECUTE statement, and accept a timeout name only right after SET LOCAL or RESET.
  for (const execute of bodies.matchAll(/\bEXECUTE\b/giu)) {
    const statementEnd = bodies.indexOf(";", execute.index);
    const text = withStrings.slice(execute.index, statementEnd === -1 ? withStrings.length : statementEnd);
    for (const name of text.matchAll(/\b(lock_timeout|statement_timeout)\b/giu)) {
      if (!/\b(?:SET\s+LOCAL|RESET)\s+$/iu.test(text.slice(0, name.index))) {
        sessionFindings.push({ setting: name[1], index: execute.index });
      }
    }
  }
  // A string that starts with SET <timeout> is executed somewhere (EXECUTE v), even when it is built apart.
  for (const match of withStrings.matchAll(/(?:'|\$[A-Za-z_]*\$)\s*SET\s+(?:SESSION\s+)?(lock_timeout|statement_timeout)\b/giu)) {
    sessionFindings.push({ setting: match[1], index: match.index });
  }
  // ALTER ROLE / DATABASE / SYSTEM ... SET changes the default for every later session, not just this one.
  for (const match of bodies.matchAll(/\bALTER\s+(?:ROLE|USER|DATABASE|SYSTEM)\b[^;]*?\bSET\s+(lock_timeout|statement_timeout)\b/giu)) {
    findings.push({
      operation: `persistent ${match[1].toLowerCase()} change (ALTER ROLE/DATABASE/SYSTEM SET)`,
      line: sql.slice(0, match.index).split(/\r?\n/u).length,
    });
  }
  // set_config(name, value, is_local): anything but a clear `true` for is_local is session-wide. Locate calls
  // where code is (not in message text), then read the arguments, which may nest calls, from the text that
  // still has its strings. A name that is not one plain literal could be built to name a timeout.
  const SET_CONFIG_LOCAL = /^\(?\s*(?:true|'(?:t|tr|tru|true|y|ye|yes|on|1)')\s*\)?(?:\s*::\s*bool(?:ean)?)?\s*$/iu;
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
    const name = (args[0] ?? "").trim();
    const timeout =
      /^[Ee]?'(lock_timeout|statement_timeout)'$/iu.exec(name) ?? /^(\$[A-Za-z_]*\$)(lock_timeout|statement_timeout)\1$/iu.exec(name);
    const plainLiteral = /^[Ee]?'[^']*'$/u.test(name) || /^(\$[A-Za-z_]*\$)[^$]*\1$/u.test(name);
    if (SET_CONFIG_LOCAL.test(args[2] ?? "")) continue;
    if (timeout) {
      sessionFindings.push({ setting: timeout[2] ?? timeout[1], index: call.index });
    } else if (!plainLiteral) {
      sessionFindings.push({ setting: "lock_timeout/statement_timeout", index: call.index, dynamic: true });
    }
  }
  const reported = new Set();
  for (const { setting, index, dynamic } of sessionFindings) {
    const line = sql.slice(0, index).split(/\r?\n/u).length;
    const operation = dynamic
      ? "set_config() with a computed setting name and no is_local = true (could set a session-level timeout; use a literal name)"
      : `session-level ${setting.toLowerCase()} change (use SET LOCAL or set_config(..., true))`;
    if (reported.has(`${line}:${operation}`)) continue;
    reported.add(`${line}:${operation}`);
    findings.push({ operation, line });
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

// The migration runner applies *.sql files by filename and never reads meta/_journal.json, so a journal that
// has drifted from the files breaks `drizzle-kit generate` and hides collisions between PRs that each add
// the next migration. Entries before this idx predate the ordering check: idx 9 was committed with an earlier
// `when` than idx 8 and cannot be rewritten without changing applied history.
const JOURNAL_ORDER_ENFORCED_FROM_IDX = 10;

function checkJournal(migrationsDir) {
  const journalFile = path.join(migrationsDir, "meta", "_journal.json");
  const violations = [];
  const report = (operation) => violations.push({ file: journalFile, line: 1, operation });

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(journalFile, "utf8")).entries;
    if (!Array.isArray(entries)) throw new Error("no entries array");
  } catch (error) {
    report(`migration journal is unreadable (${error instanceof Error ? error.message : String(error)})`);
    return violations;
  }

  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      report(`journal idx ${entry.idx} is at position ${position}; idx must be contiguous from 0 (${entry.tag})`);
    }
    if (typeof entry.tag !== "string" || !entry.tag.startsWith(`${String(entry.idx).padStart(4, "0")}_`)) {
      report(`journal tag ${entry.tag} does not start with its idx ${String(entry.idx).padStart(4, "0")}_`);
    }
    if (entry.idx >= JOURNAL_ORDER_ENFORCED_FROM_IDX && position > 0 && !(entry.when > entries[position - 1].when)) {
      report(
        `journal idx ${entry.idx} (${entry.tag}) has when=${entry.when}, not after idx ${entries[position - 1].idx}; ` +
          "a migration merged out of order would be skipped by drizzle-kit",
      );
    }
  });

  const files = fs.readdirSync(migrationsDir).filter((name) => /^\d{4}_.*\.sql$/u.test(name));
  const tags = new Set(entries.map((entry) => entry.tag));
  for (const name of files) {
    if (!tags.has(name.slice(0, -".sql".length))) report(`${name} has no journal entry`);
  }
  const present = new Set(files);
  for (const tag of tags) {
    if (!present.has(`${tag}.sql`)) report(`journal entry ${tag} has no ${tag}.sql file`);
  }
  const seen = new Map();
  for (const name of files) {
    const prefix = name.slice(0, 4);
    if (seen.has(prefix)) report(`migrations ${seen.get(prefix)} and ${name} share the number ${prefix}`);
    else seen.set(prefix, name);
  }
  return violations;
}

function journalDirsFor(files, explicitDirs) {
  const dirs = new Set(explicitDirs.map((dir) => path.resolve(dir)));
  for (const file of files) {
    const dir = path.dirname(path.resolve(file));
    if (fs.existsSync(path.join(dir, "meta", "_journal.json"))) dirs.add(dir);
  }
  return [...dirs];
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
  const files = [];
  const journalDirs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--journal") {
      const dir = argv[(index += 1)];
      if (!dir) throw new Error("--journal needs a migrations directory");
      journalDirs.push(dir);
    } else {
      files.push(argv[index]);
    }
  }
  if (files.length === 0 && journalDirs.length === 0) {
    console.error("Usage: node scripts/check-migration-safety.js [--journal <migrations-dir>] <migration.sql> [...]");
    return 2;
  }

  // A migration next to meta/_journal.json also gets the journal checked, so adding one cannot leave it stale.
  const violations = [...checkFiles(files), ...journalDirsFor(files, journalDirs).flatMap(checkJournal)];
  if (violations.length === 0) {
    console.log(`Migration safety check passed for ${files.length} file(s).`);
    return 0;
  }

  console.error("Unsafe database migration operations are not allowed by default:");
  for (const violation of violations) {
    console.error(`- ${path.relative(process.cwd(), violation.file)}:${violation.line} ${violation.operation}`);
  }
  console.error(
    "Restore timeout settings before the migration ends. Use an expand/contract migration for schema changes. For an intentional cleanup phase, add " +
      '"-- migration-safety: allow-destructive issue=#123" immediately before the statement. ' +
      "Journal errors mean meta/_journal.json and the .sql files disagree: renumber the newer migration and its snapshot, then rebase.",
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

module.exports = { checkFiles, checkJournal, findUnsafeStatements, maskSqlLiteralsAndComments };
