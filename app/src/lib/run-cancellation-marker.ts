/**
 * errorDetails value that marks a run as cancelled by a user. Dependency-free so query code can use it
 * without loading the queue module. Keep identical to the worker's copy (asserted by cancellation-marker.spec.ts).
 */
export const RUN_CANCELLATION_MARKER = "Cancellation requested by user";
