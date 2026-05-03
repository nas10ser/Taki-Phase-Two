// DEV-gated logger.
// `info` and `log` print only in development; `warn` and `error` always print so
// production observability stays intact.
// Parcel inlines `process.env.NODE_ENV` and dead-code-eliminates the DEV branch
// from production bundles.
const isDev = process.env.NODE_ENV !== 'production';

type LogArgs = unknown[];

export const logger = {
    info: (...args: LogArgs) => { if (isDev) console.info(...args); },
    log:  (...args: LogArgs) => { if (isDev) console.log(...args); },
    warn: (...args: LogArgs) => { console.warn(...args); },
    error:(...args: LogArgs) => { console.error(...args); },
};
