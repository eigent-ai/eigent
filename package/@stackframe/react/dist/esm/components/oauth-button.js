"use client";
"use client";

// src/components/oauth-button.tsx
import { BrandIcons, Button } from "@stackframe/stack-ui";
import Color from "color";
import { useEffect, useId, useState } from "react";
import { useStackApp } from "..";
import { useTranslation } from "../lib/translations";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var iconSize = 22;
var changeColor = (c, value) => {
  if (c.isLight()) {
    value = -value;
  }
  return c.hsl(c.hue(), c.saturationl(), c.lightness() + value).toString();
};
function OAuthButton({
  provider,
  type,
  isMock = false
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const styleId = useId().replaceAll(":", "-");
  const [lastUsed, setLastUsed] = useState(null);
  useEffect(() => {
    setLastUsed(localStorage.getItem("_STACK_AUTH.lastUsed"));
  }, []);
  let style;
  switch (provider) {
    case "google": {
      style = {
        backgroundColor: "#fff",
        textColor: "#000",
        name: "Google",
        border: "1px solid #ddd",
        icon: /* @__PURE__ */ jsx(BrandIcons.Google, { iconSize })
      };
      break;
    }
    case "github": {
      style = {
        backgroundColor: "#111",
        textColor: "#fff",
        border: "1px solid #333",
        name: "GitHub",
        icon: /* @__PURE__ */ jsx(BrandIcons.GitHub, { iconSize })
      };
      break;
    }
    case "facebook": {
      style = {
        backgroundColor: "#1877F2",
        textColor: "#fff",
        name: "Facebook",
        icon: /* @__PURE__ */ jsx(BrandIcons.Facebook, { iconSize })
      };
      break;
    }
    case "microsoft": {
      style = {
        backgroundColor: "#2f2f2f",
        textColor: "#fff",
        name: "Microsoft",
        icon: /* @__PURE__ */ jsx(BrandIcons.Microsoft, { iconSize })
      };
      break;
    }
    case "spotify": {
      style = {
        backgroundColor: "#1DB954",
        textColor: "#fff",
        name: "Spotify",
        icon: /* @__PURE__ */ jsx(BrandIcons.Spotify, { iconSize })
      };
      break;
    }
    case "discord": {
      style = {
        backgroundColor: "#5865F2",
        textColor: "#fff",
        name: "Discord",
        icon: /* @__PURE__ */ jsx(BrandIcons.Discord, { iconSize })
      };
      break;
    }
    case "gitlab": {
      style = {
        backgroundColor: "#111",
        textColor: "#fff",
        border: "1px solid #333",
        name: "Gitlab",
        icon: /* @__PURE__ */ jsx(BrandIcons.Gitlab, { iconSize })
      };
      break;
    }
    case "apple": {
      style = {
        backgroundColor: "#000",
        textColor: "#fff",
        border: "1px solid #333",
        name: "Apple",
        icon: /* @__PURE__ */ jsx(BrandIcons.Apple, { iconSize })
      };
      break;
    }
    case "bitbucket": {
      style = {
        backgroundColor: "#fff",
        textColor: "#000",
        border: "1px solid #ddd",
        name: "Bitbucket",
        icon: /* @__PURE__ */ jsx(BrandIcons.Bitbucket, { iconSize })
      };
      break;
    }
    case "linkedin": {
      style = {
        backgroundColor: "#0073b1",
        textColor: "#fff",
        name: "LinkedIn",
        icon: /* @__PURE__ */ jsx(BrandIcons.LinkedIn, { iconSize })
      };
      break;
    }
    case "x": {
      style = {
        backgroundColor: "#000",
        textColor: "#fff",
        name: "X",
        icon: /* @__PURE__ */ jsx(BrandIcons.X, { iconSize })
      };
      break;
    }
    default: {
      style = {
        name: provider,
        icon: null
      };
    }
  }
  const styleSheet = `
    .stack-oauth-button-${styleId} {
      background-color: ${style.backgroundColor} !important;
      color: ${style.textColor} !important;
      border: ${style.border} !important;
    }
    .stack-oauth-button-${styleId}:hover {
      background-color: ${changeColor(Color(style.backgroundColor), 10)} !important;
    }
  `;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("style", { children: styleSheet }),
    /* @__PURE__ */ jsxs(
      Button,
      {
        onClick: async () => {
          localStorage.setItem("_STACK_AUTH.lastUsed", provider);
          await stackApp.signInWithOAuth(provider);
        },
        className: `stack-oauth-button-${styleId} stack-scope relative`,
        children: [
          !isMock && lastUsed === provider && /* @__PURE__ */ jsx("span", { className: "absolute -top-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-md", children: "last" }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center w-full gap-4", children: [
            style.icon,
            /* @__PURE__ */ jsx("span", { className: "flex-1", children: type === "sign-up" ? t("Sign up with {provider}", { provider: style.name }) : t("Sign in with {provider}", { provider: style.name }) })
          ] })
        ]
      }
    )
  ] });
}
export {
  OAuthButton
};
//# sourceMappingURL=oauth-button.js.map