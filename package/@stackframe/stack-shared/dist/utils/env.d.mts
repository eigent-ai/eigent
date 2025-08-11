declare function isBrowserLike(): boolean;
/**
 * Returns the environment variable with the given name, returning the default (if given) or throwing an error (otherwise) if it's undefined or the empty string.
 */
declare function getEnvVariable(name: string, defaultValue?: string | undefined): string;
declare function getNextRuntime(): string;
declare function getNodeEnvironment(): string;

export { getEnvVariable, getNextRuntime, getNodeEnvironment, isBrowserLike };
