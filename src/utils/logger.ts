/**
 * Vortex Engine Logger - Production Grade
 * Comprehensive logging with levels, formatting, and output options
 * 
 * Features:
 * - Multiple log levels (debug, info, warn, error)
 * - Structured JSON logging option
 * - Timestamp formatting
 * - Context/metadata support
 * - Log rotation ready
 * - Performance optimized
 * 
 * @package VortexEngine
 * @version 4.0.0
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    [key: string]: any;
}

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: LogContext;
    service?: string;
    requestId?: string;
}

// Configuration
const CONFIG = {
    level: (process.env.LOG_LEVEL || 'info') as LogLevel,
    jsonFormat: process.env.LOG_FORMAT === 'json',
    includeTimestamp: true,
    service: process.env.SERVICE_NAME || 'vortex-engine',
    maxContextLength: 1000
};

// Log level hierarchy
const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

// Colors for console output
const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
};

// Level colors
const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: COLORS.gray,
    info: COLORS.cyan,
    warn: COLORS.yellow,
    error: COLORS.red
};

// Level labels
const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: 'DEBUG',
    info: 'INFO ',
    warn: 'WARN ',
    error: 'ERROR'
};

/**
 * Format timestamp for logging
 */
function formatTimestamp(): string {
    return new Date().toISOString();
}

/**
 * Check if log level should be output
 */
function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[CONFIG.level];
}

/**
 * Truncate context to prevent huge logs
 */
function truncateContext(context: LogContext): LogContext {
    const str = JSON.stringify(context);
    if (str.length <= CONFIG.maxContextLength) {
        return context;
    }
    
    return {
        _truncated: true,
        _originalLength: str.length,
        ...Object.fromEntries(
            Object.entries(context).slice(0, 5).map(([k, v]) => {
                const vs = JSON.stringify(v);
                if (vs.length > 200) {
                    return [k, typeof v === 'string' ? v.slice(0, 200) + '...' : '[truncated]'];
                }
                return [k, v];
            })
        )
    };
}

/**
 * Format log entry for console output
 */
function formatConsoleLog(entry: LogEntry): string {
    const color = LEVEL_COLORS[entry.level];
    const label = LEVEL_LABELS[entry.level];
    
    let output = '';
    
    if (CONFIG.includeTimestamp) {
        output += `${COLORS.gray}${entry.timestamp}${COLORS.reset} `;
    }
    
    output += `${color}[${label}]${COLORS.reset} `;
    output += entry.message;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
        output += ` ${COLORS.dim}${JSON.stringify(entry.context)}${COLORS.reset}`;
    }
    
    return output;
}

/**
 * Format log entry for JSON output
 */
function formatJsonLog(entry: LogEntry): string {
    return JSON.stringify(entry);
}

/**
 * Output log entry
 */
function outputLog(level: LogLevel, entry: LogEntry): void {
    const formatted = CONFIG.jsonFormat 
        ? formatJsonLog(entry) 
        : formatConsoleLog(entry);
    
    switch (level) {
        case 'error':
            console.error(formatted);
            break;
        case 'warn':
            console.warn(formatted);
            break;
        default:
            console.log(formatted);
    }
}

/**
 * Create log entry
 */
function createLogEntry(
    level: LogLevel, 
    message: string, 
    context?: LogContext
): LogEntry {
    const entry: LogEntry = {
        timestamp: formatTimestamp(),
        level,
        message,
        service: CONFIG.service
    };
    
    if (context) {
        entry.context = truncateContext(context);
    }
    
    return entry;
}

/**
 * Parse arguments to extract message and context
 */
function parseArgs(args: any[]): { message: string; context?: LogContext } {
    if (args.length === 0) {
        return { message: '' };
    }
    
    // First argument is always message or will be converted to string
    let message = String(args[0]);
    let context: LogContext | undefined;
    
    // Process remaining arguments
    if (args.length > 1) {
        const rest = args.slice(1);
        
        // If second arg is an object and there are no more args, treat as context
        if (rest.length === 1 && typeof rest[0] === 'object' && rest[0] !== null) {
            if (rest[0] instanceof Error) {
                context = {
                    error: rest[0].message,
                    stack: rest[0].stack?.split('\n').slice(0, 5).join('\n')
                };
            } else {
                context = rest[0];
            }
        } else {
            // Otherwise, append to message and collect objects as context
            const contextData: LogContext = {};
            let i = 0;
            
            for (const arg of rest) {
                if (typeof arg === 'object' && arg !== null) {
                    if (arg instanceof Error) {
                        contextData[`error_${i}`] = {
                            message: arg.message,
                            stack: arg.stack?.split('\n').slice(0, 3).join('\n')
                        };
                    } else {
                        Object.assign(contextData, arg);
                    }
                } else {
                    message += ' ' + String(arg);
                }
                i++;
            }
            
            if (Object.keys(contextData).length > 0) {
                context = contextData;
            }
        }
    }
    
    return { message, context };
}

/**
 * Logger class for more advanced use cases
 */
class Logger {
    private prefix: string;
    private defaultContext: LogContext;
    
    constructor(prefix?: string, defaultContext?: LogContext) {
        this.prefix = prefix || '';
        this.defaultContext = defaultContext || {};
    }
    
    private log(level: LogLevel, ...args: any[]): void {
        if (!shouldLog(level)) return;
        
        let { message, context } = parseArgs(args);
        
        if (this.prefix) {
            message = `${this.prefix} ${message}`;
        }
        
        if (context || Object.keys(this.defaultContext).length > 0) {
            context = { ...this.defaultContext, ...(context || {}) };
        }
        
        const entry = createLogEntry(level, message, context);
        outputLog(level, entry);
    }
    
    debug(...args: any[]): void {
        this.log('debug', ...args);
    }
    
    info(...args: any[]): void {
        this.log('info', ...args);
    }
    
    warn(...args: any[]): void {
        this.log('warn', ...args);
    }
    
    error(...args: any[]): void {
        this.log('error', ...args);
    }
    
    /**
     * Create child logger with prefix
     */
    child(prefix: string, context?: LogContext): Logger {
        const newPrefix = this.prefix ? `${this.prefix} ${prefix}` : prefix;
        return new Logger(newPrefix, { ...this.defaultContext, ...context });
    }
    
    /**
     * Time a function execution
     */
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const start = Date.now();
        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.info(`${label} completed`, { duration_ms: duration });
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            this.error(`${label} failed`, { duration_ms: duration, error });
            throw error;
        }
    }
}

// Export singleton logger instance
export const logger = {
    debug: (...args: any[]): void => {
        if (!shouldLog('debug')) return;
        const { message, context } = parseArgs(args);
        const entry = createLogEntry('debug', message, context);
        outputLog('debug', entry);
    },
    
    info: (...args: any[]): void => {
        if (!shouldLog('info')) return;
        const { message, context } = parseArgs(args);
        const entry = createLogEntry('info', message, context);
        outputLog('info', entry);
    },
    
    warn: (...args: any[]): void => {
        if (!shouldLog('warn')) return;
        const { message, context } = parseArgs(args);
        const entry = createLogEntry('warn', message, context);
        outputLog('warn', entry);
    },
    
    error: (...args: any[]): void => {
        if (!shouldLog('error')) return;
        const { message, context } = parseArgs(args);
        const entry = createLogEntry('error', message, context);
        outputLog('error', entry);
    },
    
    /**
     * Create child logger with prefix
     */
    child: (prefix: string, context?: LogContext): Logger => {
        return new Logger(prefix, context);
    },
    
    /**
     * Time an async operation
     */
    time: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
        const start = Date.now();
        try {
            const result = await fn();
            const duration = Date.now() - start;
            logger.info(`${label} completed`, { duration_ms: duration });
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            logger.error(`${label} failed`, { duration_ms: duration, error });
            throw error;
        }
    },
    
    /**
     * Set log level at runtime
     */
    setLevel: (level: LogLevel): void => {
        CONFIG.level = level;
        logger.info(`Log level set to: ${level}`);
    },
    
    /**
     * Get current log level
     */
    getLevel: (): LogLevel => CONFIG.level
};

// Export Logger class for creating instances
export { Logger, LogLevel, LogContext, LogEntry };
