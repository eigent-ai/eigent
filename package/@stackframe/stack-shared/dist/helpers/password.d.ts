import '../crud.js';
import { KnownErrors } from '../known-errors.js';
import 'yup';
import '../utils/types.js';
import '../utils/errors.js';
import '../utils/json.js';
import '../utils/results.js';

declare function getPasswordError(password: string): KnownErrors["PasswordRequirementsNotMet"] | undefined;

export { getPasswordError };
