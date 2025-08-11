// src/components-page/account-settings/section.tsx
import { Separator, Typography } from "@stackframe/stack-ui";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function Section(props) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(Separator, {}),
    /* @__PURE__ */ jsxs("div", { className: "flex flex-col sm:flex-row gap-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "sm:flex-1 flex flex-col justify-center", children: [
        /* @__PURE__ */ jsx(Typography, { className: "font-medium", children: props.title }),
        props.description && /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "footnote", children: props.description })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "sm:flex-1 sm:items-end flex flex-col gap-2 ", children: props.children })
    ] })
  ] });
}
export {
  Section
};
//# sourceMappingURL=section.js.map