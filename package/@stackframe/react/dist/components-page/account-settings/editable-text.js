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

// src/components-page/account-settings/editable-text.tsx
var editable_text_exports = {};
__export(editable_text_exports, {
  EditableText: () => EditableText
});
module.exports = __toCommonJS(editable_text_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var import_translations = require("../../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function EditableText(props) {
  const [editing, setEditing] = (0, import_react.useState)(false);
  const [editingValue, setEditingValue] = (0, import_react.useState)(props.value);
  const { t } = (0, import_translations.useTranslation)();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex items-center gap-2", children: editing ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_stack_ui.Input,
      {
        value: editingValue,
        onChange: (e) => setEditingValue(e.target.value)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_stack_ui.Button,
      {
        size: "sm",
        onClick: async () => {
          await props.onSave?.(editingValue);
          setEditing(false);
        },
        children: t("Save")
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_stack_ui.Button,
      {
        size: "sm",
        variant: "secondary",
        onClick: () => {
          setEditingValue(props.value);
          setEditing(false);
        },
        children: t("Cancel")
      }
    )
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: props.value }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { onClick: () => setEditing(true), size: "icon", variant: "ghost", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.Edit, { className: "w-4 h-4" }) })
  ] }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EditableText
});
//# sourceMappingURL=editable-text.js.map