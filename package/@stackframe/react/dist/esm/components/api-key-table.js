"use client";
"use client";

// src/components/api-key-table.tsx
import { ActionCell, ActionDialog, BadgeCell, DataTable, DataTableColumnHeader, DataTableFacetedFilter, DateCell, SearchToolbarItem, TextCell, standardFilterFn } from "@stackframe/stack-ui";
import { useMemo, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function toolbarRender(table) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(SearchToolbarItem, { table, placeholder: "Search table" }),
    /* @__PURE__ */ jsx(
      DataTableFacetedFilter,
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
  return /* @__PURE__ */ jsx(
    ActionDialog,
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
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(RevokeDialog, { apiKey: row.original, open: isRevokeModalOpen, onOpenChange: setIsRevokeModalOpen }),
    /* @__PURE__ */ jsx(
      ActionCell,
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
    header: ({ column }) => /* @__PURE__ */ jsx(DataTableColumnHeader, { column, columnTitle: "Description" }),
    cell: ({ row }) => /* @__PURE__ */ jsx(TextCell, { size: 100, children: row.original.description })
  },
  {
    accessorKey: "status",
    header: ({ column }) => /* @__PURE__ */ jsx(DataTableColumnHeader, { column, columnTitle: "Status" }),
    cell: ({ row }) => /* @__PURE__ */ jsx(BadgeCell, { badges: [row.original.status] }),
    filterFn: standardFilterFn
  },
  {
    id: "value",
    accessorFn: (row) => row.value.lastFour,
    header: ({ column }) => /* @__PURE__ */ jsx(DataTableColumnHeader, { column, columnTitle: "Client Key" }),
    cell: ({ row }) => /* @__PURE__ */ jsxs(TextCell, { children: [
      "*******",
      row.original.value.lastFour
    ] }),
    enableSorting: false
  },
  {
    accessorKey: "expiresAt",
    header: ({ column }) => /* @__PURE__ */ jsx(DataTableColumnHeader, { column, columnTitle: "Expires At" }),
    cell: ({ row }) => {
      if (row.original.status === "revoked") return /* @__PURE__ */ jsx(TextCell, { children: "-" });
      return row.original.expiresAt ? /* @__PURE__ */ jsx(DateCell, { date: row.original.expiresAt, ignoreAfterYears: 50 }) : /* @__PURE__ */ jsx(TextCell, { children: "Never" });
    }
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => /* @__PURE__ */ jsx(DataTableColumnHeader, { column, columnTitle: "Created At" }),
    cell: ({ row }) => /* @__PURE__ */ jsx(DateCell, { date: row.original.createdAt, ignoreAfterYears: 50 })
  },
  {
    id: "actions",
    cell: ({ row }) => /* @__PURE__ */ jsx(Actions, { row })
  }
];
function ApiKeyTable(props) {
  const extendedApiKeys = useMemo(() => {
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
  return /* @__PURE__ */ jsx(
    DataTable,
    {
      data: extendedApiKeys,
      columns,
      toolbarRender,
      defaultColumnFilters: [],
      defaultSorting: []
    }
  );
}
export {
  ApiKeyTable
};
//# sourceMappingURL=api-key-table.js.map