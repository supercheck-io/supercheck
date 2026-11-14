/** Toast text for a failed run request: the API's `{ error }` message, else the raw body trimmed to 100 characters. */
export function runErrorMessage(errorText: string): string {
  try {
    const { error } = JSON.parse(errorText) as { error?: unknown };
    if (typeof error === "string" && error) return error;
  } catch {
    // not JSON: fall through to the raw body
  }
  const message = errorText.replace("Failed to run job: ", "");
  return message.length > 100 ? `${message.substring(0, 100)}...` : message;
}
