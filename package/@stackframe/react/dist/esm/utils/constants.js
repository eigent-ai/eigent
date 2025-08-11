// src/utils/constants.tsx
var FONT_SIZES = { "xs": "0.75rem", "sm": "0.875rem", "md": "1rem", "lg": "1.125rem", "xl": "1.25rem" };
var LINE_HEIGHTS = { "xs": "1rem", "sm": "1.25rem", "md": "1.5rem", "lg": "1.75rem", "xl": "2rem" };
var FONT_FAMILY = 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
var PRIMARY_FONT_COLORS = { "dark": "white", "light": "black" };
var SECONDARY_FONT_COLORS = { "dark": "#a8a8a8", "light": "#737373" };
var SELECTED_BACKGROUND_COLORS = { "dark": "rgba(255, 255, 255, 0.1)", "light": "rgba(0, 0, 0, 0.04)" };
var LINK_COLORS = { "dark": "#fff", "light": "#000" };
var SHADOW = "0 1px 2px 0 rgba(0, 0, 0, 0.05)";
var DEFAULT_THEME = {
  light: {
    background: "hsl(0 0% 100%)",
    foreground: "hsl(240 10% 3.9%)",
    card: "hsl(0 0% 100%)",
    cardForeground: "hsl(240 10% 3.9%)",
    popover: "hsl(0 0% 100%)",
    popoverForeground: "hsl(240 10% 3.9%)",
    primary: "hsl(240 5.9% 10%)",
    primaryForeground: "hsl(0 0% 98%)",
    secondary: "hsl(240 4.8% 95.9%)",
    secondaryForeground: "hsl(240 5.9% 10%)",
    muted: "hsl(240 4.8% 95.9%)",
    mutedForeground: "hsl(240 3.8% 46.1%)",
    accent: "hsl(240 4.8% 95.9%)",
    accentForeground: "hsl(240 5.9% 10%)",
    destructive: "hsl(0 84.2% 60.2%)",
    destructiveForeground: "hsl(0 0% 98%)",
    border: "hsl(240 5.9% 90%)",
    input: "hsl(240 5.9% 90%)",
    ring: "hsl(240 10% 3.9%)"
  },
  dark: {
    background: "hsl(240 10% 3.9%)",
    foreground: "hsl(0 0% 98%)",
    card: "hsl(240 10% 3.9%)",
    cardForeground: "hsl(0 0% 98%)",
    popover: "hsl(240 10% 3.9%)",
    popoverForeground: "hsl(0 0% 98%)",
    primary: "hsl(0 0% 98%)",
    primaryForeground: "hsl(240 5.9% 10%)",
    secondary: "hsl(240 3.7% 15.9%)",
    secondaryForeground: "hsl(0 0% 98%)",
    muted: "hsl(240 3.7% 15.9%)",
    mutedForeground: "hsl(240 5% 64.9%)",
    accent: "hsl(240 3.7% 15.9%)",
    accentForeground: "hsl(0 0% 98%)",
    destructive: "hsl(0 62.8% 50%)",
    destructiveForeground: "hsl(0 0% 98%)",
    border: "hsl(240 3.7% 15.9%)",
    input: "hsl(240 3.7% 15.9%)",
    ring: "hsl(240 4.9% 83.9%)"
  },
  radius: "0.5rem"
};
export {
  DEFAULT_THEME,
  FONT_FAMILY,
  FONT_SIZES,
  LINE_HEIGHTS,
  LINK_COLORS,
  PRIMARY_FONT_COLORS,
  SECONDARY_FONT_COLORS,
  SELECTED_BACKGROUND_COLORS,
  SHADOW
};
//# sourceMappingURL=constants.js.map