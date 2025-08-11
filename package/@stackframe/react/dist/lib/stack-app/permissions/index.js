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

// src/lib/stack-app/permissions/index.ts
var permissions_exports = {};
__export(permissions_exports, {
  adminProjectPermissionDefinitionCreateOptionsToCrud: () => adminProjectPermissionDefinitionCreateOptionsToCrud,
  adminProjectPermissionDefinitionUpdateOptionsToCrud: () => adminProjectPermissionDefinitionUpdateOptionsToCrud,
  adminTeamPermissionDefinitionCreateOptionsToCrud: () => adminTeamPermissionDefinitionCreateOptionsToCrud,
  adminTeamPermissionDefinitionUpdateOptionsToCrud: () => adminTeamPermissionDefinitionUpdateOptionsToCrud
});
module.exports = __toCommonJS(permissions_exports);
function adminTeamPermissionDefinitionCreateOptionsToCrud(options) {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds
  };
}
function adminTeamPermissionDefinitionUpdateOptionsToCrud(options) {
  return {
    description: options.description,
    contained_permission_ids: options.containedPermissionIds
  };
}
function adminProjectPermissionDefinitionCreateOptionsToCrud(options) {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds
  };
}
function adminProjectPermissionDefinitionUpdateOptionsToCrud(options) {
  return {
    description: options.description,
    contained_permission_ids: options.containedPermissionIds
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  adminProjectPermissionDefinitionCreateOptionsToCrud,
  adminProjectPermissionDefinitionUpdateOptionsToCrud,
  adminTeamPermissionDefinitionCreateOptionsToCrud,
  adminTeamPermissionDefinitionUpdateOptionsToCrud
});
//# sourceMappingURL=index.js.map