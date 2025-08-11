declare function fileToBase64(file: File): Promise<string>;
declare function validateBase64Image(base64: string): boolean;

export { fileToBase64, validateBase64Image };
