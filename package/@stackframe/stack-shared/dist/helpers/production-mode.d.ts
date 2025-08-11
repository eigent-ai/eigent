import { ProjectsCrud } from '../interface/crud/projects.js';
import '../crud.js';
import 'yup';
import '../utils/types.js';

type ProductionModeError = {
    message: string;
    relativeFixUrl: `/${string}`;
};
declare function getProductionModeErrors(project: ProjectsCrud["Admin"]["Read"]): ProductionModeError[];

export { type ProductionModeError, getProductionModeErrors };
