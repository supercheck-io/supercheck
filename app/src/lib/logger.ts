export class Logger {
  private prefix: string;

  constructor(prefix: string = "[App]") {
    this.prefix = prefix;
  }

  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(
    level: string,
    message: string,
    ...optionalParams: unknown[]
  ): string {
    const paramsString =
      optionalParams.length > 0
        ? ` ${optionalParams.map((p) => JSON.stringify(p)).join(" ")}`
        : "";
    return `${this.getCurrentTimestamp()} ${
      this.prefix
    } [${level.toUpperCase()}] ${message}${paramsString}`;
  }

  log(message: string, ...optionalParams: unknown[]): void {
    console.log(this.formatMessage("log", message, ...optionalParams));
  }

  info(message: string, ...optionalParams: unknown[]): void {
    console.info(this.formatMessage("info", message, ...optionalParams));
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    console.warn(this.formatMessage("warn", message, ...optionalParams));
  }

  error(message: string, ...optionalParams: unknown[]): void {
    console.error(this.formatMessage("error", message, ...optionalParams));
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    // console.debug is not standard on all Node versions, so using log
    console.log(this.formatMessage("debug", message, ...optionalParams));
  }
}

// Global default logger instance (optional)
export const defaultLogger = new Logger();
