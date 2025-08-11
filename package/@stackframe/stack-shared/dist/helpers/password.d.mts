import '../crud.mjs';
import { KnownErrors } from '../known-errors.mjs';
import 'yup';
import '../utils/types.mjs';
import '../utils/errors.mjs';
import '../utils/json.mjs';
import '../utils/results.mjs';

declare function getPasswordError(password: string): KnownErrors["PasswordRequirementsNotMet"] | undefined;

export { getPasswordError };
