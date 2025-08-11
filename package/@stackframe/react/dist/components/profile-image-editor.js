"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/components/profile-image-editor.tsx
var profile_image_editor_exports = {};
__export(profile_image_editor_exports, {
  ProfileImageEditor: () => ProfileImageEditor,
  checkImageUrl: () => checkImageUrl
});
module.exports = __toCommonJS(profile_image_editor_exports);
var import_base64 = require("@stackframe/stack-shared/dist/utils/base64");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_browser_image_compression = __toESM(require("browser-image-compression"));
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var import_react_avatar_editor = __toESM(require("react-avatar-editor"));
var import_translations = require("../lib/translations");
var import_user_avatar = require("./elements/user-avatar");
var import_jsx_runtime = require("react/jsx-runtime");
async function checkImageUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const buff = await res.blob();
    return buff.type.startsWith("image/");
  } catch (e) {
    return false;
  }
}
function ProfileImageEditor(props) {
  const { t } = (0, import_translations.useTranslation)();
  const cropRef = (0, import_react.useRef)(null);
  const [slideValue, setSlideValue] = (0, import_react.useState)(1);
  const [rawUrl, setRawUrl] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  function reset() {
    setSlideValue(1);
    setRawUrl(null);
    setError(null);
  }
  function upload() {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      (0, import_promises.runAsynchronouslyWithAlert)(async () => {
        const rawUrl2 = await (0, import_base64.fileToBase64)(file);
        if (await checkImageUrl(rawUrl2)) {
          setRawUrl(rawUrl2);
          setError(null);
        } else {
          setError(t("Invalid image"));
        }
        input.remove();
      });
    };
    input.click();
  }
  if (!rawUrl) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "cursor-pointer relative", onClick: upload, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_user_avatar.UserAvatar,
          {
            size: 60,
            user: props.user,
            border: true
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute top-0 left-0 h-[60px] w-[60px] bg-gray-500/20 backdrop-blur-sm items-center justify-center rounded-full flex opacity-0 hover:opacity-100 transition-opacity", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bg-background p-2 rounded-full", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.Upload, { className: "h-5 w-5" }) }) })
      ] }),
      error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", type: "label", children: error })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col items-center gap-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_react_avatar_editor.default,
      {
        ref: cropRef,
        image: rawUrl || props.user.profileImageUrl || "",
        borderRadius: 1e3,
        color: [0, 0, 0, 0.72],
        scale: slideValue,
        rotate: 0,
        border: 20,
        className: "border"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_stack_ui.Slider,
      {
        min: 1,
        max: 5,
        step: 0.1,
        defaultValue: [slideValue],
        value: [slideValue],
        onValueChange: (v) => setSlideValue(v[0])
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-row gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          onClick: async () => {
            if (cropRef.current && rawUrl) {
              const croppedUrl = cropRef.current.getImage().toDataURL("image/jpeg");
              const compressedFile = await (0, import_browser_image_compression.default)(
                await import_browser_image_compression.default.getFilefromDataUrl(croppedUrl, "profile-image"),
                {
                  maxSizeMB: 0.1,
                  fileType: "image/jpeg"
                }
              );
              const compressedUrl = await import_browser_image_compression.default.getDataUrlFromFile(compressedFile);
              await props.onProfileImageUrlChange(compressedUrl);
              reset();
            }
          },
          children: t("Save")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          variant: "secondary",
          onClick: reset,
          children: t("Cancel")
        }
      )
    ] })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProfileImageEditor,
  checkImageUrl
});
//# sourceMappingURL=profile-image-editor.js.map