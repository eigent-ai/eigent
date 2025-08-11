import { Json } from './json.js';
import './results.js';

declare function throwErr(errorMessage: string, extraData?: any): never;
declare function throwErr(error: Error): never;
declare function throwErr(...args: StatusErrorConstructorParameters): never;
/**
 * Concatenates the (original) stacktraces of the given errors onto the first.
 *
 * Useful when you invoke an async function to receive a promise without awaiting it immediately. Browsers are smart
 * enough to keep track of the call stack in async function calls when you invoke `.then` within the same async tick,
 * but if you don't, the stacktrace will be lost.
 *
 * Here's an example of the unwanted behavior:
 *
 * ```tsx
 * async function log() {
 *   await wait(0);  // simulate an put the task on the event loop
 *   console.log(new Error().stack);
 * }
 *
 * async function main() {
 *   await log();  // good; prints both "log" and "main" on the stacktrace
 *   log();  // bad; prints only "log" on the stacktrace
 * }
 * ```
 */
declare function concatStacktraces(first: Error, ...errors: Error[]): void;
declare class StackAssertionError extends Error {
    readonly extraData?: (Record<string, any> & ErrorOptions) | undefined;
    constructor(message: string, extraData?: (Record<string, any> & ErrorOptions) | undefined);
}
declare function errorToNiceString(error: unknown): string;
declare function registerErrorSink(sink: (location: string, error: unknown) => void): void;
declare function captureError(location: string, error: unknown): void;
type Status = {
    statusCode: number;
    message: string;
};
type StatusErrorConstructorParameters = [
    status: Status,
    message?: string
] | [
    statusCode: number | Status,
    message: string
];
declare class StatusError extends Error {
    private readonly __stackStatusErrorBrand;
    name: string;
    readonly statusCode: number;
    static BadRequest: {
        statusCode: number;
        message: string;
    };
    static Unauthorized: {
        statusCode: number;
        message: string;
    };
    static PaymentRequired: {
        statusCode: number;
        message: string;
    };
    static Forbidden: {
        statusCode: number;
        message: string;
    };
    static NotFound: {
        statusCode: number;
        message: string;
    };
    static MethodNotAllowed: {
        statusCode: number;
        message: string;
    };
    static NotAcceptable: {
        statusCode: number;
        message: string;
    };
    static ProxyAuthenticationRequired: {
        statusCode: number;
        message: string;
    };
    static RequestTimeout: {
        statusCode: number;
        message: string;
    };
    static Conflict: {
        statusCode: number;
        message: string;
    };
    static Gone: {
        statusCode: number;
        message: string;
    };
    static LengthRequired: {
        statusCode: number;
        message: string;
    };
    static PreconditionFailed: {
        statusCode: number;
        message: string;
    };
    static PayloadTooLarge: {
        statusCode: number;
        message: string;
    };
    static URITooLong: {
        statusCode: number;
        message: string;
    };
    static UnsupportedMediaType: {
        statusCode: number;
        message: string;
    };
    static RangeNotSatisfiable: {
        statusCode: number;
        message: string;
    };
    static ExpectationFailed: {
        statusCode: number;
        message: string;
    };
    static ImATeapot: {
        statusCode: number;
        message: string;
    };
    static MisdirectedRequest: {
        statusCode: number;
        message: string;
    };
    static UnprocessableEntity: {
        statusCode: number;
        message: string;
    };
    static Locked: {
        statusCode: number;
        message: string;
    };
    static FailedDependency: {
        statusCode: number;
        message: string;
    };
    static TooEarly: {
        statusCode: number;
        message: string;
    };
    static UpgradeRequired: {
        statusCode: number;
        message: string;
    };
    static PreconditionRequired: {
        statusCode: number;
        message: string;
    };
    static TooManyRequests: {
        statusCode: number;
        message: string;
    };
    static RequestHeaderFieldsTooLarge: {
        statusCode: number;
        message: string;
    };
    static UnavailableForLegalReasons: {
        statusCode: number;
        message: string;
    };
    static InternalServerError: {
        statusCode: number;
        message: string;
    };
    static NotImplemented: {
        statusCode: number;
        message: string;
    };
    static BadGateway: {
        statusCode: number;
        message: string;
    };
    static ServiceUnavailable: {
        statusCode: number;
        message: string;
    };
    static GatewayTimeout: {
        statusCode: number;
        message: string;
    };
    static HTTPVersionNotSupported: {
        statusCode: number;
        message: string;
    };
    static VariantAlsoNegotiates: {
        statusCode: number;
        message: string;
    };
    static InsufficientStorage: {
        statusCode: number;
        message: string;
    };
    static LoopDetected: {
        statusCode: number;
        message: string;
    };
    static NotExtended: {
        statusCode: number;
        message: string;
    };
    static NetworkAuthenticationRequired: {
        statusCode: number;
        message: string;
    };
    constructor(...args: StatusErrorConstructorParameters);
    static isStatusError(error: unknown): error is StatusError;
    isClientError(): boolean;
    isServerError(): boolean;
    getStatusCode(): number;
    getBody(): Uint8Array;
    getHeaders(): Record<string, string[]>;
    toDescriptiveJson(): Json;
    /**
     * @deprecated this is not a good way to make status errors human-readable, use toDescriptiveJson instead
     */
    toHttpJson(): Json;
}

export { StackAssertionError, StatusError, captureError, concatStacktraces, errorToNiceString, registerErrorSink, throwErr };
