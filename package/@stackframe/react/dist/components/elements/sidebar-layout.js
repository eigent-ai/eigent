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

// src/components/elements/sidebar-layout.tsx
var sidebar_layout_exports = {};
__export(sidebar_layout_exports, {
  SidebarLayout: () => SidebarLayout
});
module.exports = __toCommonJS(sidebar_layout_exports);
var import_use_hash = require("@stackframe/stack-shared/dist/hooks/use-hash");
var import_stack_ui = require("@stackframe/stack-ui");
var import_lucide_react = require("lucide-react");
var import__ = require("../..");
var import_jsx_runtime = require("react/jsx-runtime");
function SidebarLayout(props) {
  const hash = (0, import_use_hash.useHash)();
  const selectedIndex = props.items.findIndex((item) => item.id && item.id === hash);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: (0, import_stack_ui.cn)("hidden sm:flex stack-scope h-full", props.className), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DesktopLayout, { items: props.items, title: props.title, selectedIndex }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: (0, import_stack_ui.cn)("sm:hidden stack-scope h-full", props.className), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MobileLayout, { items: props.items, title: props.title, selectedIndex }) })
  ] });
}
function Items(props) {
  const app = (0, import__.useStackApp)();
  const navigate = app.useNavigate();
  const activeItemIndex = props.selectedIndex === -1 ? 0 : props.selectedIndex;
  return props.items.map((item, index) => item.type === "item" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    import_stack_ui.Button,
    {
      variant: "ghost",
      size: "sm",
      className: (0, import_stack_ui.cn)(
        activeItemIndex === index && "sm:bg-muted",
        "justify-start text-md text-zinc-800 dark:text-zinc-300 px-2 text-left"
      ),
      onClick: () => {
        if (item.id) {
          navigate("#" + item.id);
        }
      },
      children: [
        item.icon,
        item.title
      ]
    },
    index
  ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: item.title }, index));
}
function DesktopLayout(props) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "stack-scope flex w-full h-full max-w-full relative", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex max-w-[200px] min-w-[200px] border-r flex-col items-stretch gap-2 p-2 overflow-y-auto", children: [
      props.title && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mb-2 ml-2", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h2", className: "text-lg font-semibold text-zinc-800 dark:text-zinc-300", children: props.title }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Items, { items: props.items, selectedIndex: props.selectedIndex })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex-1 w-0 flex justify-center gap-4 py-2 px-4", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col max-w-[800px] w-[800px]", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-4 mb-6", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h4", className: "font-semibold", children: selectedItem.title }),
        selectedItem.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "label", children: selectedItem.description })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex-1", children: selectedItem.content })
    ] }) })
  ] });
}
function MobileLayout(props) {
  const selectedItem = props.items[props.selectedIndex];
  const app = (0, import__.useStackApp)();
  const navigate = app.useNavigate();
  if (props.selectedIndex === -1) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2 p-2", children: [
      props.title && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mb-2 ml-2", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h2", className: "text-lg font-semibold text-zinc-800 dark:text-zinc-300", children: props.title }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Items, { items: props.items, selectedIndex: props.selectedIndex })
    ] });
  } else {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex-1 flex flex-col gap-4 py-2 px-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex justify-between", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h4", className: "font-semibold", children: selectedItem.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Button,
            {
              variant: "ghost",
              size: "icon",
              onClick: () => {
                navigate("#");
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.XIcon, { className: "h-5 w-5" })
            }
          )
        ] }),
        selectedItem.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "label", children: selectedItem.description })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex-1", children: selectedItem.content })
    ] });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SidebarLayout
});
//# sourceMappingURL=sidebar-layout.js.map