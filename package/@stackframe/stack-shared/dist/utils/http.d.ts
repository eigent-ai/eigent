declare const HTTP_METHODS: {
    readonly GET: {
        readonly safe: true;
        readonly idempotent: true;
    };
    readonly POST: {
        readonly safe: false;
        readonly idempotent: false;
    };
    readonly PUT: {
        readonly safe: false;
        readonly idempotent: true;
    };
    readonly DELETE: {
        readonly safe: false;
        readonly idempotent: true;
    };
    readonly PATCH: {
        readonly safe: false;
        readonly idempotent: false;
    };
    readonly OPTIONS: {
        readonly safe: true;
        readonly idempotent: true;
    };
    readonly HEAD: {
        readonly safe: true;
        readonly idempotent: true;
    };
    readonly TRACE: {
        readonly safe: true;
        readonly idempotent: true;
    };
    readonly CONNECT: {
        readonly safe: false;
        readonly idempotent: false;
    };
};
type HttpMethod = keyof typeof HTTP_METHODS;
declare function decodeBasicAuthorizationHeader(value: string): [string, string] | null;
declare function encodeBasicAuthorizationHeader(id: string, password: string): string;

export { HTTP_METHODS, type HttpMethod, decodeBasicAuthorizationHeader, encodeBasicAuthorizationHeader };
