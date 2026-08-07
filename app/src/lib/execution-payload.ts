/**
 * Removes decrypted tenant secrets before an execution task crosses the
 * process boundary into Redis/BullMQ. The worker resolves current project
 * secrets immediately before isolated execution.
 */
export function omitExecutionSecrets<T extends { secrets?: unknown }>(
  task: T,
): Omit<T, "secrets"> {
  const { secrets: _secrets, ...safeTask } = task;
  return safeTask;
}
