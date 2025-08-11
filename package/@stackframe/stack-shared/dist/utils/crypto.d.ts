declare function generateRandomValues(array: Uint8Array): typeof array;
/**
 * Generates a secure alphanumeric string using the system's cryptographically secure
 * random number generator.
 */
declare function generateSecureRandomString(minBitsOfEntropy?: number): string;

export { generateRandomValues, generateSecureRandomString };
