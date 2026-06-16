import dateFormat from 'dateformat';
import colors from 'colors';

const severityValues: Record<string, number> = {
    debug: 1,
    warning: 2,
    error: 3,
    special: 4
};

function severityToColor(severity: string, text: string): string {
    switch (severity) {
        case 'special':
            return text.cyan.underline;
        case 'debug':
            return text.green;
        case 'warning':
            return text.yellow;
        case 'error':
            return text.red;
        default:
            console.log('Unknown severity ' + severity);
            return text.italic;
    }
}

export interface PoolLoggerConfig {
    logLevel: string;
    logColors?: boolean;
}

export interface Logger {
    debug(...args: Array<string | undefined>): void;
    warning(...args: Array<string | undefined>): void;
    error(...args: Array<string | undefined>): void;
    special(...args: Array<string | undefined>): void;
}

interface PoolLoggerConstructor {
    new (configuration: PoolLoggerConfig): Logger;
}

const PoolLogger = function (this: any, configuration: PoolLoggerConfig) {
    const logLevelInt = severityValues[configuration.logLevel];
    const logColors = configuration.logColors;

    const log = function (
        severity: string,
        system?: string,
        component?: string,
        text?: string,
        subcat?: string
    ): void {
        if (severityValues[severity] < logLevelInt) return;

        if (subcat) {
            const realText = subcat;
            const realSubCat = text;
            text = realText;
            subcat = realSubCat;
        }

        let entryDesc =
            dateFormat(new Date(), 'yyyy/mm/dd HH:MM:ss') +
            ' [' +
            system +
            ']\t';
        let logString: string;
        if (logColors) {
            entryDesc = severityToColor(severity, entryDesc);
            logString = entryDesc + ('[' + component + '] ').italic;
            // `.bold` collides with lib.es5's String.prototype.bold(); use the
            // colors module's chainable form instead of the string augmentation.
            if (subcat) logString += colors.bold.grey('(' + subcat + ') ');
            if (text) logString += text.grey;
        } else {
            logString = entryDesc + '[' + component + '] ';
            if (subcat) logString += '(' + subcat + ') ';
            logString += text;
        }

        console.log(logString);
    };

    // public: debug / warning / error / special, generated from severityValues
    const _this: any = this;
    Object.keys(severityValues).forEach(function (logType) {
        _this[logType] = function (
            system?: string,
            component?: string,
            text?: string,
            subcat?: string
        ) {
            log(logType, system, component, text, subcat);
        };
    });
} as unknown as PoolLoggerConstructor;

export default PoolLogger;
