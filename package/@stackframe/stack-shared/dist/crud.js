"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/crud.tsx
var crud_exports = {};
__export(crud_exports, {
  createCrud: () => createCrud
});
module.exports = __toCommonJS(crud_exports);
var import_schema_fields = require("./schema-fields");
var import_objects = require("./utils/objects");
function createCrud(options) {
  const docs = options.docs ?? {};
  const client = {
    createSchema: options.clientCreateSchema,
    createDocs: docs.clientCreate,
    readSchema: options.clientReadSchema,
    readDocs: docs.clientRead,
    listDocs: docs.clientList,
    updateSchema: options.clientUpdateSchema,
    updateDocs: docs.clientUpdate,
    deleteSchema: options.clientDeleteSchema,
    deleteDocs: docs.clientDelete
  };
  const serverOverrides = (0, import_objects.filterUndefined)({
    createSchema: options.serverCreateSchema,
    createDocs: docs.serverCreate,
    readSchema: options.serverReadSchema,
    readDocs: docs.serverRead,
    listDocs: docs.serverList,
    updateSchema: options.serverUpdateSchema,
    updateDocs: docs.serverUpdate,
    deleteSchema: options.serverDeleteSchema,
    deleteDocs: docs.serverDelete
  });
  const server = {
    ...client,
    ...serverOverrides
  };
  const adminOverrides = (0, import_objects.filterUndefined)({
    createSchema: options.adminCreateSchema,
    createDocs: docs.adminCreate,
    readSchema: options.adminReadSchema,
    readDocs: docs.adminRead,
    listDocs: docs.adminList,
    updateSchema: options.adminUpdateSchema,
    updateDocs: docs.adminUpdate,
    deleteSchema: options.adminDeleteSchema,
    deleteDocs: docs.adminDelete
  });
  const admin = {
    ...server,
    ...adminOverrides
  };
  return {
    client,
    server,
    admin,
    hasCreate: !!admin.createSchema,
    hasRead: !!admin.readSchema,
    hasUpdate: !!admin.updateSchema,
    hasDelete: !!admin.deleteSchema
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createCrud
});
//# sourceMappingURL=crud.js.map