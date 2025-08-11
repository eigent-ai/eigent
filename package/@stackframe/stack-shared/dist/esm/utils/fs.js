// src/utils/fs.tsx
import * as stackFs from "fs";
import * as path from "path";
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
export {
  list,
  listRecursively,
  writeFileSyncIfChanged
};
//# sourceMappingURL=fs.js.map