// Data conflicts must abort migrations; never mark a failed unique constraint
// as applied merely because PostgreSQL reports duplicate key values.
function isIgnorableMigrationStatementError(statement, errorMessage, errorCode) {
  if (String(errorCode ?? "").startsWith("23")) return false;
  const normalizedStatement = statement.toLowerCase().replace(/\s+/g, " ").trim();

  if (
    errorMessage.includes("already exists") ||
    (errorMessage.includes("constraint") && errorMessage.includes("already exists"))
  ) {
    return true;
  }

  if (!errorMessage.includes("does not exist")) {
    return false;
  }

  if (normalizedStatement.includes(" drop column ")) {
    return errorMessage.includes("column");
  }

  if (normalizedStatement.includes(" drop constraint ")) {
    return errorMessage.includes("constraint");
  }

  if (normalizedStatement.startsWith("drop index ")) {
    return errorMessage.includes("index") || errorMessage.includes("relation");
  }

  if (normalizedStatement.startsWith("drop table ")) {
    return errorMessage.includes("table") || errorMessage.includes("relation");
  }

  return false;
}

module.exports = { isIgnorableMigrationStatementError };
