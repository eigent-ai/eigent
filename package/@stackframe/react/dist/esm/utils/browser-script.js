// src/utils/browser-script.tsx
import { SsrScript } from "../components/elements/ssr-layout-effect";
import { jsx } from "react/jsx-runtime";
var script = () => {
  const attributes = ["data-joy-color-scheme", "data-mui-color-scheme", "data-theme", "data-color-scheme", "class"];
  const getColorMode = (value) => {
    if (value.includes("dark")) {
      return "dark";
    }
    if (value.includes("light")) {
      return "light";
    }
    return null;
  };
  const setTheme = (mode) => {
    let el = document.getElementById(`--stack-theme-mode`);
    if (!el) {
      el = document.createElement("style");
      el.id = `--stack-theme-mode`;
      el.innerHTML = `/* This tag is used by Stack Auth to set the theme in the browser without causing a hydration error (since React ignores additional tags in the <head>). We later use the \`html:has(head > [data-stack-theme=XYZ])\` selector to apply styles based on the theme. */`;
      document.head.appendChild(el);
    }
    el.setAttribute("data-stack-theme", mode);
  };
  const colorToRGB = (color) => {
    const temp = document.createElement("div");
    temp.style.color = color;
    document.body.appendChild(temp);
    const computedColor = getComputedStyle(temp).color;
    document.body.removeChild(temp);
    const match = computedColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (match) {
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    }
    return null;
  };
  const rgbToLuma = (rgb) => {
    return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1e3;
  };
  const copyFromColorScheme = () => {
    const colorScheme = getComputedStyle(document.documentElement).getPropertyValue("color-scheme");
    if (colorScheme) {
      const mode = getColorMode(colorScheme);
      if (mode) {
        setTheme(mode);
        return true;
      }
    }
    return false;
  };
  const copyFromVariables = () => {
    let backgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--background");
    if (backgroundColor) {
      if (/^\d+\s\d+%\s\d+(\.\d+)?%$/.test(backgroundColor)) {
        backgroundColor = `hsl(${backgroundColor})`;
      }
      const rgb = colorToRGB(backgroundColor);
      if (rgb) {
        const luma = rgbToLuma(rgb);
        if (luma < 128) {
          setTheme("dark");
        } else {
          setTheme("light");
        }
        return true;
      }
    }
    return false;
  };
  const copyFromAttributes = () => {
    for (const attributeName of attributes) {
      const colorTheme = document.documentElement.getAttribute(attributeName);
      if (colorTheme) {
        const mode = getColorMode(colorTheme);
        if (mode) {
          setTheme(mode);
          return true;
        }
      }
    }
    return false;
  };
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (copyFromColorScheme()) {
        return;
      }
      if (mutation.attributeName && attributes.includes(mutation.attributeName) && copyFromAttributes()) {
        return;
      }
      if (copyFromVariables()) {
        return;
      }
    });
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: attributes
  });
  if (!copyFromColorScheme()) {
    if (!copyFromAttributes()) {
      copyFromVariables();
    }
  }
};
function BrowserScript(props) {
  return /* @__PURE__ */ jsx(SsrScript, { nonce: props.nonce, script: `(${script.toString()})()` });
}
export {
  BrowserScript
};
//# sourceMappingURL=browser-script.js.map