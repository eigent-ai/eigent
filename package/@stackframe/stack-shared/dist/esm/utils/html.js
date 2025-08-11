// src/utils/html.tsx
import { templateIdentity } from "./strings";
function escapeHtml(unsafe) {
  return `${unsafe}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function html(strings, ...values) {
  return templateIdentity(strings, ...values.map((v) => escapeHtml(`${v}`)));
}
export {
  escapeHtml,
  html
};
//# sourceMappingURL=html.js.map