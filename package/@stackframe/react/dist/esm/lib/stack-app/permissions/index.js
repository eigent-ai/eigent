// src/lib/stack-app/permissions/index.ts
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
export {
  adminProjectPermissionDefinitionCreateOptionsToCrud,
  adminProjectPermissionDefinitionUpdateOptionsToCrud,
  adminTeamPermissionDefinitionCreateOptionsToCrud,
  adminTeamPermissionDefinitionUpdateOptionsToCrud
};
//# sourceMappingURL=index.js.map