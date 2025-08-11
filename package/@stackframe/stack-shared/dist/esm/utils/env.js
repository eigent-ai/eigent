// src/utils/env.tsx
import { throwErr } from "./errors";
import { deindent } from "./strings";
function isBrowserLike() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof document.createElement !== "undefined";
}
var ENV_VAR_RENAME = {
  NEXT_PUBLIC_STACK_API_URL: ["STACK_BASE_URL", "NEXT_PUBLIC_STACK_URL"]
};
function getEnvVariable(name, defaultValue) {
  if (isBrowserLike()) {
    throw new Error(deindent`
      Can't use getEnvVariable on the client because Next.js transpiles expressions of the kind process.env.XYZ at build-time on the client.
    
      Use process.env.XYZ directly instead.
    `);
  }
  if (name === "NEXT_RUNTIME") {
    throw new Error(deindent`
      Can't use getEnvVariable to access the NEXT_RUNTIME environment variable because it's compiled into the client bundle.
    
      Use getNextRuntime() instead.
    `);
  }
  for (const [newName, oldNames] of Object.entries(ENV_VAR_RENAME)) {
    if (oldNames.includes(name)) {
      throwErr(`Environment variable ${name} has been renamed to ${newName}. Please update your configuration to use the new name.`);
    }
  }
  let value = process.env[name];
  if (!value && ENV_VAR_RENAME[name]) {
    for (const oldName of ENV_VAR_RENAME[name]) {
      value = process.env[oldName];
      if (value) break;
    }
  }
  if (value === void 0) {
    if (defaultValue !== void 0) {
      value = defaultValue;
    } else {
      throwErr(`Missing environment variable: ${name}`);
    }
  }
  return value;
}
function getNextRuntime() {
  return process.env.NEXT_RUNTIME || throwErr("Missing environment variable: NEXT_RUNTIME");
}
function getNodeEnvironment() {
  return getEnvVariable("NODE_ENV", "");
}
export {
  getEnvVariable,
  getNextRuntime,
  getNodeEnvironment,
  isBrowserLike
};
//# sourceMappingURL=env.js.map