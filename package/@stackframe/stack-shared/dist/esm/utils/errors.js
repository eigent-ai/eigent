// src/utils/errors.tsx
import { globalVar } from "./globals";
import { pick } from "./objects";
import { nicify } from "./strings";
function throwErr(...args) {
  if (typeof args[0] === "string") {
    throw new StackAssertionError(args[0], args[1]);
  } else if (args[0] instanceof Error) {
    throw args[0];
  } else {
    throw new StatusError(...args);
  }
}
function removeStacktraceNameLine(stack) {
  const addsNameLine = new Error().stack?.startsWith("Error\n");
  return stack.split("\n").slice(addsNameLine ? 1 : 0).join("\n");
}
function concatStacktraces(first, ...errors) {
  const addsEmptyLineAtEnd = first.stack?.endsWith("\n");
  const separator = removeStacktraceNameLine(new Error().stack ?? "").split("\n")[0];
  for (const error of errors) {
    const toAppend = removeStacktraceNameLine(error.stack ?? "");
    first.stack += (addsEmptyLineAtEnd ? "" : "\n") + separator + "\n" + toAppend;
  }
}
var StackAssertionError = class extends Error {
  constructor(message, extraData) {
    const disclaimer = `

This is likely an error in Stack. Please make sure you are running the newest version and report it.`;
    super(`${message}${message.endsWith(disclaimer) ? "" : disclaimer}`, pick(extraData ?? {}, ["cause"]));
    this.extraData = extraData;
    Object.defineProperty(this, "customCaptureExtraArgs", {
      get() {
        return [this.extraData];
      },
      enumerable: false
    });
  }
};
StackAssertionError.prototype.name = "StackAssertionError";
function errorToNiceString(error) {
  if (!(error instanceof Error)) return `${typeof error}<${nicify(error)}>`;
  return nicify(error, { maxDepth: 8 });
}
var errorSinks = /* @__PURE__ */ new Set();
function registerErrorSink(sink) {
  if (errorSinks.has(sink)) {
    return;
  }
  errorSinks.add(sink);
}
registerErrorSink((location, error, ...extraArgs) => {
  console.error(
    `\x1B[41mCaptured error in ${location}:`,
    // HACK: Log a nicified version of the error to get around buggy Next.js pretty-printing
    // https://www.reddit.com/r/nextjs/comments/1gkxdqe/comment/m19kxgn/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button
    errorToNiceString(error),
    ...extraArgs,
    "\x1B[0m"
  );
});
registerErrorSink((location, error, ...extraArgs) => {
  globalVar.stackCapturedErrors = globalVar.stackCapturedErrors ?? [];
  globalVar.stackCapturedErrors.push({ location, error, extraArgs });
});
function captureError(location, error) {
  for (const sink of errorSinks) {
    sink(
      location,
      error,
      ...error && (typeof error === "object" || typeof error === "function") && "customCaptureExtraArgs" in error && Array.isArray(error.customCaptureExtraArgs) ? error.customCaptureExtraArgs : []
    );
  }
}
var StatusError = class extends Error {
  constructor(status, message) {
    if (typeof status === "object") {
      message ??= status.message;
      status = status.statusCode;
    }
    super(message);
    this.__stackStatusErrorBrand = "stack-status-error-brand-sentinel";
    this.name = "StatusError";
    this.statusCode = status;
    if (!message) {
      throw new StackAssertionError("StatusError always requires a message unless a Status object is passed", { cause: this });
    }
  }
  static isStatusError(error) {
    return typeof error === "object" && error !== null && "__stackStatusErrorBrand" in error && error.__stackStatusErrorBrand === "stack-status-error-brand-sentinel";
  }
  isClientError() {
    return this.statusCode >= 400 && this.statusCode < 500;
  }
  isServerError() {
    return !this.isClientError();
  }
  getStatusCode() {
    return this.statusCode;
  }
  getBody() {
    return new TextEncoder().encode(this.message);
  }
  getHeaders() {
    return {
      "Content-Type": ["text/plain; charset=utf-8"]
    };
  }
  toDescriptiveJson() {
    return {
      status_code: this.getStatusCode(),
      message: this.message,
      headers: this.getHeaders()
    };
  }
  /**
   * @deprecated this is not a good way to make status errors human-readable, use toDescriptiveJson instead
   */
  toHttpJson() {
    return {
      status_code: this.statusCode,
      body: this.message,
      headers: this.getHeaders()
    };
  }
};
StatusError.BadRequest = { statusCode: 400, message: "Bad Request" };
StatusError.Unauthorized = { statusCode: 401, message: "Unauthorized" };
StatusError.PaymentRequired = { statusCode: 402, message: "Payment Required" };
StatusError.Forbidden = { statusCode: 403, message: "Forbidden" };
StatusError.NotFound = { statusCode: 404, message: "Not Found" };
StatusError.MethodNotAllowed = { statusCode: 405, message: "Method Not Allowed" };
StatusError.NotAcceptable = { statusCode: 406, message: "Not Acceptable" };
StatusError.ProxyAuthenticationRequired = { statusCode: 407, message: "Proxy Authentication Required" };
StatusError.RequestTimeout = { statusCode: 408, message: "Request Timeout" };
StatusError.Conflict = { statusCode: 409, message: "Conflict" };
StatusError.Gone = { statusCode: 410, message: "Gone" };
StatusError.LengthRequired = { statusCode: 411, message: "Length Required" };
StatusError.PreconditionFailed = { statusCode: 412, message: "Precondition Failed" };
StatusError.PayloadTooLarge = { statusCode: 413, message: "Payload Too Large" };
StatusError.URITooLong = { statusCode: 414, message: "URI Too Long" };
StatusError.UnsupportedMediaType = { statusCode: 415, message: "Unsupported Media Type" };
StatusError.RangeNotSatisfiable = { statusCode: 416, message: "Range Not Satisfiable" };
StatusError.ExpectationFailed = { statusCode: 417, message: "Expectation Failed" };
StatusError.ImATeapot = { statusCode: 418, message: "I'm a teapot" };
StatusError.MisdirectedRequest = { statusCode: 421, message: "Misdirected Request" };
StatusError.UnprocessableEntity = { statusCode: 422, message: "Unprocessable Entity" };
StatusError.Locked = { statusCode: 423, message: "Locked" };
StatusError.FailedDependency = { statusCode: 424, message: "Failed Dependency" };
StatusError.TooEarly = { statusCode: 425, message: "Too Early" };
StatusError.UpgradeRequired = { statusCode: 426, message: "Upgrade Required" };
StatusError.PreconditionRequired = { statusCode: 428, message: "Precondition Required" };
StatusError.TooManyRequests = { statusCode: 429, message: "Too Many Requests" };
StatusError.RequestHeaderFieldsTooLarge = { statusCode: 431, message: "Request Header Fields Too Large" };
StatusError.UnavailableForLegalReasons = { statusCode: 451, message: "Unavailable For Legal Reasons" };
StatusError.InternalServerError = { statusCode: 500, message: "Internal Server Error" };
StatusError.NotImplemented = { statusCode: 501, message: "Not Implemented" };
StatusError.BadGateway = { statusCode: 502, message: "Bad Gateway" };
StatusError.ServiceUnavailable = { statusCode: 503, message: "Service Unavailable" };
StatusError.GatewayTimeout = { statusCode: 504, message: "Gateway Timeout" };
StatusError.HTTPVersionNotSupported = { statusCode: 505, message: "HTTP Version Not Supported" };
StatusError.VariantAlsoNegotiates = { statusCode: 506, message: "Variant Also Negotiates" };
StatusError.InsufficientStorage = { statusCode: 507, message: "Insufficient Storage" };
StatusError.LoopDetected = { statusCode: 508, message: "Loop Detected" };
StatusError.NotExtended = { statusCode: 510, message: "Not Extended" };
StatusError.NetworkAuthenticationRequired = { statusCode: 511, message: "Network Authentication Required" };
StatusError.prototype.name = "StatusError";
export {
  StackAssertionError,
  StatusError,
  captureError,
  concatStacktraces,
  errorToNiceString,
  registerErrorSink,
  throwErr
};
//# sourceMappingURL=errors.js.map