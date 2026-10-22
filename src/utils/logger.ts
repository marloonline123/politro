export type LogLevel = 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';

class Logger {
  private levelPriority: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    SUCCESS: 2,
    WARN: 3,
    ERROR: 4,
  };

  private currentLevel: LogLevel = 'INFO';

  public setLevel(level: LogLevel) {
    this.currentLevel = level;
  }

  private sanitize(message: string): string {
    // Redact potential API keys or tokens
    return message
      .replace(/(?:key|token|auth|password|secret|bearer)\s*[:=]\s*([a-zA-Z0-9_\-]{8,})/gi, '$1=***REDACTED***')
      .replace(/(sk-[a-zA-Z0-9_-]{20,})/gi, 'sk-***REDACTED***');
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    let metaStr = '';
    if (meta && Object.keys(meta).length > 0) {
      metaStr = ` | ${JSON.stringify(meta)}`;
    }
    return `[${timestamp}] [${level}] ${this.sanitize(message)}${this.sanitize(metaStr)}`;
  }

  public debug(message: string, meta?: Record<string, unknown>) {
    if (this.levelPriority['DEBUG'] >= this.levelPriority[this.currentLevel]) {
      console.debug(`\x1b[90m${this.formatMessage('DEBUG', message, meta)}\x1b[0m`);
    }
  }

  public info(message: string, meta?: Record<string, unknown>) {
    if (this.levelPriority['INFO'] >= this.levelPriority[this.currentLevel]) {
      console.log(`\x1b[36m${this.formatMessage('INFO', message, meta)}\x1b[0m`);
    }
  }

  public success(message: string, meta?: Record<string, unknown>) {
    if (this.levelPriority['SUCCESS'] >= this.levelPriority[this.currentLevel]) {
      console.log(`\x1b[32m${this.formatMessage('SUCCESS', message, meta)}\x1b[0m`);
    }
  }

  public warn(message: string, meta?: Record<string, unknown>) {
    if (this.levelPriority['WARN'] >= this.levelPriority[this.currentLevel]) {
      console.warn(`\x1b[33m${this.formatMessage('WARN', message, meta)}\x1b[0m`);
    }
  }

  public error(message: string, meta?: Record<string, unknown>) {
    if (this.levelPriority['ERROR'] >= this.levelPriority[this.currentLevel]) {
      console.error(`\x1b[31m${this.formatMessage('ERROR', message, meta)}\x1b[0m`);
    }
  }
}

export const logger = new Logger();
