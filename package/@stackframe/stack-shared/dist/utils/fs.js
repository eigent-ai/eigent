"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/fs.tsx
var fs_exports = {};
__export(fs_exports, {
  list: () => list,
  listRecursively: () => listRecursively,
  writeFileSyncIfChanged: () => writeFileSyncIfChanged
});
module.exports = __toCommonJS(fs_exports);
var stackFs = __toESM(require("fs"));
var path = __toESM(require("path"));
async function list(path2) {
  return await stackFs.promises.readdir(path2);
}
async function listRecursively(p, options = {}) {
  const files = await list(p);
  return [
    ...(await Promise.all(files.map(async (fileName) => {
      const filePath = path.join(p, fileName);
      if ((await stackFs.promises.stat(filePath)).isDirectory()) {
        return [
          ...await listRecursively(filePath, options),
          ...options.excludeDirectories ? [] : [filePath]
        ];
      } else {
        return [filePath];
      }
    }))).flat()
  ];
}
function writeFileSyncIfChanged(path2, content) {
  if (stackFs.existsSync(path2)) {
    const existingContent = stackFs.readFileSync(path2, "utf-8");
    if (existingContent === content) {
      return;
    }
  }
  stackFs.writeFileSync(path2, content);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  list,
  listRecursively,
  writeFileSyncIfChanged
});
//# sourceMappingURL=fs.js.map