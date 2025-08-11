declare function sha512(input: Uint8Array | string): Promise<Uint8Array>;
declare function hashPassword(password: string): Promise<string>;
declare function comparePassword(password: string, hash: string): Promise<boolean>;
declare function isPasswordHashValid(hash: string): Promise<boolean>;
declare function getPasswordHashAlgorithm(hash: string): Promise<"bcrypt" | undefined>;

export { comparePassword, getPasswordHashAlgorithm, hashPassword, isPasswordHashValid, sha512 };
