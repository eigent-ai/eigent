"use client";
"use strict";
"use client";
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

// src/components/api-key-table.tsx
var api_key_table_exports = {};
__export(api_key_table_exports, {
  ApiKeyTable: () => ApiKeyTable
});
module.exports = __toCommonJS(api_key_table_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function toolbarRender(table) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SearchToolbarItem, { table, placeholder: "Search table" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_stack_ui.DataTableFacetedFilter,
      {
        column: table.getColumn("status"),
        title: "Status",
        options: ["valid", "expired", "revoked"].map((provider) => ({
          value: provider,
          label: provider
        }))
      }
    )
  ] });
}
function RevokeDialog(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_stack_ui.ActionDialog,
    {
      open: props.open,
      onOpenChange: props.onOpenChange,
      title: "Revoke API Key",
      danger: true,
      cancelButton: true,
      okButton: { label: "Revoke Key", onClick: async () => {
        await props.apiKey.revoke();
      } },
      confirmText: "I understand this will unlink all the apps using this API key",
      children: `Are you sure you want to revoke API key *****${props.apiKey.value.lastFour}?`
    }
  );
}
function Actions({ row }) {
  const [isRevokeModalOpen, setIsRevokeModalOpen] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RevokeDialog, { apiKey: row.original, open: isRevokeModalOpen, onOpenChange: setIsRevokeModalOpen }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_stack_ui.ActionCell,
      {
        invisible: row.original.status !== "valid",
        items: [{
          item: "Revoke",
          danger: true,
          onClick: () => setIsRevokeModalOpen(true)
        }]
      }
    )
  ] });
}
var columns = [
  {
    accessorKey: "description",
    header: ({ column }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DataTableColumnHeader, { column, columnTitle: "Description" }),
    cell: ({ row }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TextCell, { size: 100, children: row.original.description })
  },
  {
    accessorKey: "status",
    header: ({ column }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DataTableColumnHeader, { column, columnTitle: "Status" }),
    cell: ({ row }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BadgeCell, { badges: [row.original.status] }),
    filterFn: import_stack_ui.standardFilterFn
  },
  {
    id: "value",
    accessorFn: (row) => row.value.lastFour,
    header: ({ column }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DataTableColumnHeader, { column, columnTitle: "Client Key" }),
    cell: ({ row }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TextCell, { children: [
      "*******",
      row.original.value.lastFour
    ] }),
    enableSorting: false
  },
  {
    accessorKey: "expiresAt",
    header: ({ column }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DataTableColumnHeader, { column, columnTitle: "Expires At" }),
    cell: ({ row }) => {
      if (row.original.status === "revoked") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TextCell, { children: "-" });
      return row.original.expiresAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DateCell, { date: row.original.expiresAt, ignoreAfterYears: 50 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TextCell, { children: "Never" });
    }
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DataTableColumnHeader, { column, columnTitle: "Created At" }),
    cell: ({ row }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DateCell, { date: row.original.createdAt, ignoreAfterYears: 50 })
  },
  {
    id: "actions",
    cell: ({ row }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Actions, { row })
  }
];
function ApiKeyTable(props) {
  const extendedApiKeys = (0, import_react.useMemo)(() => {
    const keys = props.apiKeys.map((apiKey) => ({
      ...apiKey,
      status: { "valid": "valid", "manually-revoked": "revoked", "expired": "expired" }[apiKey.whyInvalid() || "valid"]
    }));
    return keys.sort((a, b) => {
      if (a.status === b.status) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return a.status === "valid" ? -1 : 1;
    });
  }, [props.apiKeys]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_stack_ui.DataTable,
    {
      data: extendedApiKeys,
      columns,
      toolbarRender,
      defaultColumnFilters: [],
      defaultSorting: []
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApiKeyTable
});
//# sourceMappingURL=api-key-table.js.map