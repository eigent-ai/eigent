declare function toHexString(input: Uint8Array): string;
declare function getBase32CharacterFromIndex(index: number): string;
declare function getBase32IndexFromCharacter(character: string): number;
declare function encodeBase32(input: Uint8Array): string;
declare function decodeBase32(input: string): Uint8Array;
declare function encodeBase64(input: Uint8Array): string;
declare function decodeBase64(input: string): Uint8Array;
declare function encodeBase64Url(input: Uint8Array): string;
declare function decodeBase64Url(input: string): Uint8Array;
declare function decodeBase64OrBase64Url(input: string): Uint8Array;
declare function isBase32(input: string): boolean;
declare function isBase64(input: string): boolean;
declare function isBase64Url(input: string): boolean;

export { decodeBase32, decodeBase64, decodeBase64OrBase64Url, decodeBase64Url, encodeBase32, encodeBase64, encodeBase64Url, getBase32CharacterFromIndex, getBase32IndexFromCharacter, isBase32, isBase64, isBase64Url, toHexString };
