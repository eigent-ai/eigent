// src/crud.tsx
import { yupObject, yupString } from "./schema-fields";
import { filterUndefined } from "./utils/objects";
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
  const serverOverrides = filterUndefined({
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
  const adminOverrides = filterUndefined({
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
export {
  createCrud
};
//# sourceMappingURL=crud.js.map