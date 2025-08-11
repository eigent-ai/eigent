import { ProjectsCrud } from '../interface/crud/projects.mjs';
import '../crud.mjs';
import 'yup';
import '../utils/types.mjs';

type ProductionModeError = {
    message: string;
    relativeFixUrl: `/${string}`;
};
declare function getProductionModeErrors(project: ProjectsCrud["Admin"]["Read"]): ProductionModeError[];

export { type ProductionModeError, getProductionModeErrors };
