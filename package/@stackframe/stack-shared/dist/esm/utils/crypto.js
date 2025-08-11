// src/utils/crypto.tsx
import { encodeBase32 } from "./bytes";
import { StackAssertionError } from "./errors";
import { globalVar } from "./globals";
function generateRandomValues(array) {
  if (!globalVar.crypto) {
    throw new StackAssertionError("Crypto API is not available in this environment. Are you using an old browser?");
  }
  if (!globalVar.crypto.getRandomValues) {
    throw new StackAssertionError("crypto.getRandomValues is not available in this environment. Are you using an old browser?");
  }
  return globalVar.crypto.getRandomValues(array);
}
function generateSecureRandomString(minBitsOfEntropy = 224) {
  const base32CharactersCount = Math.ceil(minBitsOfEntropy / 5);
  const bytesCount = Math.ceil(base32CharactersCount * 5 / 8);
  const randomBytes = generateRandomValues(new Uint8Array(bytesCount));
  const str = encodeBase32(randomBytes);
  return str.slice(str.length - base32CharactersCount).toLowerCase();
}
export {
  generateRandomValues,
  generateSecureRandomString
};
//# sourceMappingURL=crypto.js.map