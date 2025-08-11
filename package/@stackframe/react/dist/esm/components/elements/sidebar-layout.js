"use client";
"use client";

// src/components/elements/sidebar-layout.tsx
import { useHash } from "@stackframe/stack-shared/dist/hooks/use-hash";
import { Button, Typography, cn } from "@stackframe/stack-ui";
import { XIcon } from "lucide-react";
import { useStackApp } from "../..";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function SidebarLayout(props) {
  const hash = useHash();
  const selectedIndex = props.items.findIndex((item) => item.id && item.id === hash);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { className: cn("hidden sm:flex stack-scope h-full", props.className), children: /* @__PURE__ */ jsx(DesktopLayout, { items: props.items, title: props.title, selectedIndex }) }),
    /* @__PURE__ */ jsx("div", { className: cn("sm:hidden stack-scope h-full", props.className), children: /* @__PURE__ */ jsx(MobileLayout, { items: props.items, title: props.title, selectedIndex }) })
  ] });
}
function Items(props) {
  const app = useStackApp();
  const navigate = app.useNavigate();
  const activeItemIndex = props.selectedIndex === -1 ? 0 : props.selectedIndex;
  return props.items.map((item, index) => item.type === "item" ? /* @__PURE__ */ jsxs(
    Button,
    {
      variant: "ghost",
      size: "sm",
      className: cn(
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
  ) : /* @__PURE__ */ jsx(Typography, { children: item.title }, index));
}
function DesktopLayout(props) {
  const selectedItem = props.items[props.selectedIndex === -1 ? 0 : props.selectedIndex];
  return /* @__PURE__ */ jsxs("div", { className: "stack-scope flex w-full h-full max-w-full relative", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex max-w-[200px] min-w-[200px] border-r flex-col items-stretch gap-2 p-2 overflow-y-auto", children: [
      props.title && /* @__PURE__ */ jsx("div", { className: "mb-2 ml-2", children: /* @__PURE__ */ jsx(Typography, { type: "h2", className: "text-lg font-semibold text-zinc-800 dark:text-zinc-300", children: props.title }) }),
      /* @__PURE__ */ jsx(Items, { items: props.items, selectedIndex: props.selectedIndex })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "flex-1 w-0 flex justify-center gap-4 py-2 px-4", children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col max-w-[800px] w-[800px]", children: [
      /* @__PURE__ */ jsxs("div", { className: "mt-4 mb-6", children: [
        /* @__PURE__ */ jsx(Typography, { type: "h4", className: "font-semibold", children: selectedItem.title }),
        selectedItem.description && /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "label", children: selectedItem.description })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "flex-1", children: selectedItem.content })
    ] }) })
  ] });
}
function MobileLayout(props) {
  const selectedItem = props.items[props.selectedIndex];
  const app = useStackApp();
  const navigate = app.useNavigate();
  if (props.selectedIndex === -1) {
    return /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2 p-2", children: [
      props.title && /* @__PURE__ */ jsx("div", { className: "mb-2 ml-2", children: /* @__PURE__ */ jsx(Typography, { type: "h2", className: "text-lg font-semibold text-zinc-800 dark:text-zinc-300", children: props.title }) }),
      /* @__PURE__ */ jsx(Items, { items: props.items, selectedIndex: props.selectedIndex })
    ] });
  } else {
    return /* @__PURE__ */ jsxs("div", { className: "flex-1 flex flex-col gap-4 py-2 px-4", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex flex-col", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex justify-between", children: [
          /* @__PURE__ */ jsx(Typography, { type: "h4", className: "font-semibold", children: selectedItem.title }),
          /* @__PURE__ */ jsx(
            Button,
            {
              variant: "ghost",
              size: "icon",
              onClick: () => {
                navigate("#");
              },
              children: /* @__PURE__ */ jsx(XIcon, { className: "h-5 w-5" })
            }
          )
        ] }),
        selectedItem.description && /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "label", children: selectedItem.description })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "flex-1", children: selectedItem.content })
    ] });
  }
}
export {
  SidebarLayout
};
//# sourceMappingURL=sidebar-layout.js.map