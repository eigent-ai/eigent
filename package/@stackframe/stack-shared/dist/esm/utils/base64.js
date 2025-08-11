// src/utils/base64.tsx
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}
function validateBase64Image(base64) {
  const base64ImageRegex = /^data:image\/(png|jpg|jpeg|gif|bmp|webp);base64,[A-Za-z0-9+/]+={0,2}$|^[A-Za-z0-9+/]+={0,2}$/;
  return base64ImageRegex.test(base64);
}
export {
  fileToBase64,
  validateBase64Image
};
//# sourceMappingURL=base64.js.map