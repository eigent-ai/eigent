// src/components-page/account-settings/editable-text.tsx
import { Button, Input, Typography } from "@stackframe/stack-ui";
import { Edit } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "../../lib/translations";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function EditableText(props) {
  const [editing, setEditing] = useState(false);
  const [editingValue, setEditingValue] = useState(props.value);
  const { t } = useTranslation();
  return /* @__PURE__ */ jsx("div", { className: "flex items-center gap-2", children: editing ? /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      Input,
      {
        value: editingValue,
        onChange: (e) => setEditingValue(e.target.value)
      }
    ),
    /* @__PURE__ */ jsx(
      Button,
      {
        size: "sm",
        onClick: async () => {
          await props.onSave?.(editingValue);
          setEditing(false);
        },
        children: t("Save")
      }
    ),
    /* @__PURE__ */ jsx(
      Button,
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
  ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(Typography, { children: props.value }),
    /* @__PURE__ */ jsx(Button, { onClick: () => setEditing(true), size: "icon", variant: "ghost", children: /* @__PURE__ */ jsx(Edit, { className: "w-4 h-4" }) })
  ] }) });
}
export {
  EditableText
};
//# sourceMappingURL=editable-text.js.map