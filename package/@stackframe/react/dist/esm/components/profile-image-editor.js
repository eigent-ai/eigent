// src/components/profile-image-editor.tsx
import { fileToBase64 } from "@stackframe/stack-shared/dist/utils/base64";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Slider, Typography } from "@stackframe/stack-ui";
import imageCompression from "browser-image-compression";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import AvatarEditor from "react-avatar-editor";
import { useTranslation } from "../lib/translations";
import { UserAvatar } from "./elements/user-avatar";
import { jsx, jsxs } from "react/jsx-runtime";
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
  const { t } = useTranslation();
  const cropRef = useRef(null);
  const [slideValue, setSlideValue] = useState(1);
  const [rawUrl, setRawUrl] = useState(null);
  const [error, setError] = useState(null);
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
      runAsynchronouslyWithAlert(async () => {
        const rawUrl2 = await fileToBase64(file);
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
    return /* @__PURE__ */ jsxs("div", { className: "flex flex-col", children: [
      /* @__PURE__ */ jsxs("div", { className: "cursor-pointer relative", onClick: upload, children: [
        /* @__PURE__ */ jsx(
          UserAvatar,
          {
            size: 60,
            user: props.user,
            border: true
          }
        ),
        /* @__PURE__ */ jsx("div", { className: "absolute top-0 left-0 h-[60px] w-[60px] bg-gray-500/20 backdrop-blur-sm items-center justify-center rounded-full flex opacity-0 hover:opacity-100 transition-opacity", children: /* @__PURE__ */ jsx("div", { className: "bg-background p-2 rounded-full", children: /* @__PURE__ */ jsx(Upload, { className: "h-5 w-5" }) }) })
      ] }),
      error && /* @__PURE__ */ jsx(Typography, { variant: "destructive", type: "label", children: error })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-4", children: [
    /* @__PURE__ */ jsx(
      AvatarEditor,
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
    /* @__PURE__ */ jsx(
      Slider,
      {
        min: 1,
        max: 5,
        step: 0.1,
        defaultValue: [slideValue],
        value: [slideValue],
        onValueChange: (v) => setSlideValue(v[0])
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "flex flex-row gap-2", children: [
      /* @__PURE__ */ jsx(
        Button,
        {
          onClick: async () => {
            if (cropRef.current && rawUrl) {
              const croppedUrl = cropRef.current.getImage().toDataURL("image/jpeg");
              const compressedFile = await imageCompression(
                await imageCompression.getFilefromDataUrl(croppedUrl, "profile-image"),
                {
                  maxSizeMB: 0.1,
                  fileType: "image/jpeg"
                }
              );
              const compressedUrl = await imageCompression.getDataUrlFromFile(compressedFile);
              await props.onProfileImageUrlChange(compressedUrl);
              reset();
            }
          },
          children: t("Save")
        }
      ),
      /* @__PURE__ */ jsx(
        Button,
        {
          variant: "secondary",
          onClick: reset,
          children: t("Cancel")
        }
      )
    ] })
  ] });
}
export {
  ProfileImageEditor,
  checkImageUrl
};
//# sourceMappingURL=profile-image-editor.js.map