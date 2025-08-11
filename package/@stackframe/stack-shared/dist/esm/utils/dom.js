// src/utils/dom.tsx
function hasClickableParent(element) {
  const parent = element.parentElement;
  if (!parent) return false;
  if (parent.dataset.n2Clickable) return true;
  return hasClickableParent(element.parentElement);
}
export {
  hasClickableParent
};
//# sourceMappingURL=dom.js.map