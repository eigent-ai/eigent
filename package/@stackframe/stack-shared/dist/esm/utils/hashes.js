// src/utils/hashes.tsx
import bcrypt from "bcryptjs";
import { StackAssertionError } from "./errors";
async function sha512(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
}
async function hashPassword(password) {
  const passwordBytes = new TextEncoder().encode(password);
  if (passwordBytes.length >= 72) {
    throw new StackAssertionError(`Password is too long for bcrypt`, { len: passwordBytes.length });
  }
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}
async function comparePassword(password, hash) {
  switch (await getPasswordHashAlgorithm(hash)) {
    case "bcrypt": {
      return await bcrypt.compare(password, hash);
    }
    default: {
      return false;
    }
  }
}
async function isPasswordHashValid(hash) {
  return !!await getPasswordHashAlgorithm(hash);
}
async function getPasswordHashAlgorithm(hash) {
  if (typeof hash !== "string") {
    throw new StackAssertionError(`Passed non-string value to getPasswordHashAlgorithm`, { hash });
  }
  if (hash.match(/^\$2[ayb]\$.{56}$/)) {
    try {
      if (bcrypt.getRounds(hash) > 16) {
        return void 0;
      }
      await bcrypt.compare("any string", hash);
      return "bcrypt";
    } catch (e) {
      console.warn(`Error while checking bcrypt password hash. Assuming the hash is invalid`, e);
      return void 0;
    }
  } else {
    return void 0;
  }
}
export {
  comparePassword,
  getPasswordHashAlgorithm,
  hashPassword,
  isPasswordHashValid,
  sha512
};
//# sourceMappingURL=hashes.js.map