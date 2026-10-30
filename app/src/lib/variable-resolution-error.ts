/** Thrown when a used project variable cannot be resolved. The message names keys only, never values or decrypt internals, so it is safe to show users. */
export class VariableResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariableResolutionError";
  }
}
