// src/utils/unicode.tsx
import { StackAssertionError } from "./errors";
function getFlagEmoji(twoLetterCountryCode) {
  if (!/^[a-zA-Z][a-zA-Z]$/.test(twoLetterCountryCode)) throw new StackAssertionError("Country code must be two alphabetical letters");
  const codePoints = twoLetterCountryCode.toUpperCase().split("").map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
export {
  getFlagEmoji
};
//# sourceMappingURL=unicode.js.map