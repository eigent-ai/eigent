import * as yup from 'yup';
import { DeepMerge, DeepPartial } from '../utils/objects.js';
import { PrettifyType } from '../utils/types.js';
import { NormalizesTo, Config } from './format.js';

declare const configLevels: readonly ["project", "branch", "environment", "organization"];
type ConfigLevel = typeof configLevels[number];
/**
 * All fields that can be overridden at this level.
 */
declare const projectConfigSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
declare const branchConfigSchema: yup.ObjectSchema<{} & {
    rbac: {
        permissions?: Record<string, {
            description?: string | undefined;
            scope?: "project" | "team" | undefined;
            containedPermissionIds?: Record<string, true | undefined> | undefined;
        } | undefined> | undefined;
        defaultPermissions?: {
            teamCreator?: Record<string, true | undefined> | undefined;
            teamMember?: Record<string, true | undefined> | undefined;
            signUp?: Record<string, true | undefined> | undefined;
        } | undefined;
    } | undefined;
    teams: {
        createPersonalTeamOnSignUp?: boolean | undefined;
        allowClientTeamCreation?: boolean | undefined;
    } | undefined;
    users: {
        allowClientUserDeletion?: boolean | undefined;
    } | undefined;
    apiKeys: {
        enabled?: {
            team?: boolean | undefined;
            user?: boolean | undefined;
        } | undefined;
    } | undefined;
    domains: {
        allowLocalhost?: boolean | undefined;
    } | undefined;
    auth: {
        allowSignUp?: boolean | undefined;
        password?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        otp?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        passkey?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        oauth?: {
            accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
            }> | undefined;
        } | undefined;
    } | undefined;
    emails: {};
}, yup.AnyObject, {
    rbac: {
        permissions: undefined;
        defaultPermissions: {
            teamCreator: undefined;
            teamMember: undefined;
            signUp: undefined;
        };
    };
    teams: {
        createPersonalTeamOnSignUp: undefined;
        allowClientTeamCreation: undefined;
    };
    users: {
        allowClientUserDeletion: undefined;
    };
    apiKeys: {
        enabled: {
            team: undefined;
            user: undefined;
        };
    };
    domains: {
        allowLocalhost: undefined;
    };
    auth: {
        allowSignUp: undefined;
        password: {
            allowSignIn: undefined;
        };
        otp: {
            allowSignIn: undefined;
        };
        passkey: {
            allowSignIn: undefined;
        };
        oauth: {
            accountMergeStrategy: undefined;
            providers: undefined;
        };
    };
    emails: {};
}, "">;
declare const environmentConfigSchema: yup.ObjectSchema<{
    rbac: {
        permissions?: Record<string, {
            description?: string | undefined;
            scope?: "project" | "team" | undefined;
            containedPermissionIds?: Record<string, true | undefined> | undefined;
        } | undefined> | undefined;
        defaultPermissions?: {
            teamCreator?: Record<string, true | undefined> | undefined;
            teamMember?: Record<string, true | undefined> | undefined;
            signUp?: Record<string, true | undefined> | undefined;
        } | undefined;
    } | undefined;
    teams: {
        createPersonalTeamOnSignUp?: boolean | undefined;
        allowClientTeamCreation?: boolean | undefined;
    } | undefined;
    users: {
        allowClientUserDeletion?: boolean | undefined;
    } | undefined;
    apiKeys: {
        enabled?: {
            team?: boolean | undefined;
            user?: boolean | undefined;
        } | undefined;
    } | undefined;
    domains: (Omit<{
        allowLocalhost?: boolean | undefined;
    }, "trustedDomains"> & {
        trustedDomains?: Record<string, {
            baseUrl?: string | undefined;
            handlerPath?: string | undefined;
        }> | undefined;
    }) | undefined;
    auth: (Omit<{
        allowSignUp?: boolean | undefined;
        password?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        otp?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        passkey?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        oauth?: {
            accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
            }> | undefined;
        } | undefined;
    }, "oauth"> & {
        oauth?: (Omit<{
            accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
            }> | undefined;
        }, never> & {
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
                isShared?: boolean | undefined;
                clientId?: string | undefined;
                clientSecret?: string | undefined;
                facebookConfigId?: string | undefined;
                microsoftTenantId?: string | undefined;
            }> | undefined;
        }) | undefined;
    }) | undefined;
    emails: Omit<{}, never> & {
        server: {
            password?: string | undefined;
            isShared?: boolean | undefined;
            host?: string | undefined;
            port?: number | undefined;
            username?: string | undefined;
            senderName?: string | undefined;
            senderEmail?: string | undefined;
        };
    };
} & {
    auth: (Omit<{
        allowSignUp?: boolean | undefined;
        password?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        otp?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        passkey?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        oauth?: {
            accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
            }> | undefined;
        } | undefined;
    }, "oauth"> & {
        oauth?: (Omit<{
            accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
            }> | undefined;
        }, never> & {
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
                isShared?: boolean | undefined;
                clientId?: string | undefined;
                clientSecret?: string | undefined;
                facebookConfigId?: string | undefined;
                microsoftTenantId?: string | undefined;
            }> | undefined;
        }) | undefined;
    }) | undefined;
    emails: Omit<{}, never> & {
        server: {
            password?: string | undefined;
            isShared?: boolean | undefined;
            host?: string | undefined;
            port?: number | undefined;
            username?: string | undefined;
            senderName?: string | undefined;
            senderEmail?: string | undefined;
        };
    };
    domains: (Omit<{
        allowLocalhost?: boolean | undefined;
    }, "trustedDomains"> & {
        trustedDomains?: Record<string, {
            baseUrl?: string | undefined;
            handlerPath?: string | undefined;
        }> | undefined;
    }) | undefined;
}, yup.AnyObject, {
    rbac: {
        permissions: undefined;
        defaultPermissions: {
            teamCreator: undefined;
            teamMember: undefined;
            signUp: undefined;
        };
    };
    teams: {
        createPersonalTeamOnSignUp: undefined;
        allowClientTeamCreation: undefined;
    };
    users: {
        allowClientUserDeletion: undefined;
    };
    apiKeys: {
        enabled: {
            team: undefined;
            user: undefined;
        };
    };
    domains: {
        rbac: {
            permissions: undefined;
            defaultPermissions: {
                teamCreator: undefined;
                teamMember: undefined;
                signUp: undefined;
            };
        };
        teams: {
            createPersonalTeamOnSignUp: undefined;
            allowClientTeamCreation: undefined;
        };
        users: {
            allowClientUserDeletion: undefined;
        };
        apiKeys: {
            enabled: {
                team: undefined;
                user: undefined;
            };
        };
        domains: {
            allowLocalhost: undefined;
        };
        auth: {
            allowSignUp: undefined;
            password: {
                allowSignIn: undefined;
            };
            otp: {
                allowSignIn: undefined;
            };
            passkey: {
                allowSignIn: undefined;
            };
            oauth: {
                accountMergeStrategy: undefined;
                providers: undefined;
            };
        };
        emails: {};
    };
    auth: {
        rbac: {
            permissions: undefined;
            defaultPermissions: {
                teamCreator: undefined;
                teamMember: undefined;
                signUp: undefined;
            };
        };
        teams: {
            createPersonalTeamOnSignUp: undefined;
            allowClientTeamCreation: undefined;
        };
        users: {
            allowClientUserDeletion: undefined;
        };
        apiKeys: {
            enabled: {
                team: undefined;
                user: undefined;
            };
        };
        domains: {
            allowLocalhost: undefined;
        };
        auth: {
            allowSignUp: undefined;
            password: {
                allowSignIn: undefined;
            };
            otp: {
                allowSignIn: undefined;
            };
            passkey: {
                allowSignIn: undefined;
            };
            oauth: {
                accountMergeStrategy: undefined;
                providers: undefined;
            };
        };
        emails: {};
    };
    emails: {
        rbac: {
            permissions: undefined;
            defaultPermissions: {
                teamCreator: undefined;
                teamMember: undefined;
                signUp: undefined;
            };
        };
        teams: {
            createPersonalTeamOnSignUp: undefined;
            allowClientTeamCreation: undefined;
        };
        users: {
            allowClientUserDeletion: undefined;
        };
        apiKeys: {
            enabled: {
                team: undefined;
                user: undefined;
            };
        };
        domains: {
            allowLocalhost: undefined;
        };
        auth: {
            allowSignUp: undefined;
            password: {
                allowSignIn: undefined;
            };
            otp: {
                allowSignIn: undefined;
            };
            passkey: {
                allowSignIn: undefined;
            };
            oauth: {
                accountMergeStrategy: undefined;
                providers: undefined;
            };
        };
        emails: {};
    };
}, "">;
declare const organizationConfigSchema: yup.ObjectSchema<{
    rbac: {
        permissions?: Record<string, {
            description?: string | undefined;
            scope?: "project" | "team" | undefined;
            containedPermissionIds?: Record<string, true | undefined> | undefined;
        } | undefined> | undefined;
        defaultPermissions?: {
            teamCreator?: Record<string, true | undefined> | undefined;
            teamMember?: Record<string, true | undefined> | undefined;
            signUp?: Record<string, true | undefined> | undefined;
        } | undefined;
    } | undefined;
    teams: {
        createPersonalTeamOnSignUp?: boolean | undefined;
        allowClientTeamCreation?: boolean | undefined;
    } | undefined;
    users: {
        allowClientUserDeletion?: boolean | undefined;
    } | undefined;
    apiKeys: {
        enabled?: {
            team?: boolean | undefined;
            user?: boolean | undefined;
        } | undefined;
    } | undefined;
    domains: (Omit<{
        allowLocalhost?: boolean | undefined;
    }, "trustedDomains"> & {
        trustedDomains?: Record<string, {
            baseUrl?: string | undefined;
            handlerPath?: string | undefined;
        }> | undefined;
    }) | undefined;
    auth: (Omit<{
        allowSignUp?: boolean | undefined;
        password?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        otp?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        passkey?: {
            allowSignIn?: boolean | undefined;
        } | undefined;
        oauth?: {
            accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
            }> | undefined;
        } | undefined;
    }, "oauth"> & {
        oauth?: (Omit<{
            accountMergeStrategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
            }> | undefined;
        }, never> & {
            providers?: Record<string, {
                allowSignIn?: boolean | undefined;
                type?: "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | "apple" | "x" | undefined;
                allowConnectedAccounts?: boolean | undefined;
                isShared?: boolean | undefined;
                clientId?: string | undefined;
                clientSecret?: string | undefined;
                facebookConfigId?: string | undefined;
                microsoftTenantId?: string | undefined;
            }> | undefined;
        }) | undefined;
    }) | undefined;
    emails: Omit<{}, never> & {
        server: {
            password?: string | undefined;
            isShared?: boolean | undefined;
            host?: string | undefined;
            port?: number | undefined;
            username?: string | undefined;
            senderName?: string | undefined;
            senderEmail?: string | undefined;
        };
    };
} & {}, yup.AnyObject, {
    rbac: {
        permissions: undefined;
        defaultPermissions: {
            teamCreator: undefined;
            teamMember: undefined;
            signUp: undefined;
        };
    };
    teams: {
        createPersonalTeamOnSignUp: undefined;
        allowClientTeamCreation: undefined;
    };
    users: {
        allowClientUserDeletion: undefined;
    };
    apiKeys: {
        enabled: {
            team: undefined;
            user: undefined;
        };
    };
    domains: {
        rbac: {
            permissions: undefined;
            defaultPermissions: {
                teamCreator: undefined;
                teamMember: undefined;
                signUp: undefined;
            };
        };
        teams: {
            createPersonalTeamOnSignUp: undefined;
            allowClientTeamCreation: undefined;
        };
        users: {
            allowClientUserDeletion: undefined;
        };
        apiKeys: {
            enabled: {
                team: undefined;
                user: undefined;
            };
        };
        domains: {
            allowLocalhost: undefined;
        };
        auth: {
            allowSignUp: undefined;
            password: {
                allowSignIn: undefined;
            };
            otp: {
                allowSignIn: undefined;
            };
            passkey: {
                allowSignIn: undefined;
            };
            oauth: {
                accountMergeStrategy: undefined;
                providers: undefined;
            };
        };
        emails: {};
    };
    auth: {
        rbac: {
            permissions: undefined;
            defaultPermissions: {
                teamCreator: undefined;
                teamMember: undefined;
                signUp: undefined;
            };
        };
        teams: {
            createPersonalTeamOnSignUp: undefined;
            allowClientTeamCreation: undefined;
        };
        users: {
            allowClientUserDeletion: undefined;
        };
        apiKeys: {
            enabled: {
                team: undefined;
                user: undefined;
            };
        };
        domains: {
            allowLocalhost: undefined;
        };
        auth: {
            allowSignUp: undefined;
            password: {
                allowSignIn: undefined;
            };
            otp: {
                allowSignIn: undefined;
            };
            passkey: {
                allowSignIn: undefined;
            };
            oauth: {
                accountMergeStrategy: undefined;
                providers: undefined;
            };
        };
        emails: {};
    };
    emails: {
        rbac: {
            permissions: undefined;
            defaultPermissions: {
                teamCreator: undefined;
                teamMember: undefined;
                signUp: undefined;
            };
        };
        teams: {
            createPersonalTeamOnSignUp: undefined;
            allowClientTeamCreation: undefined;
        };
        users: {
            allowClientUserDeletion: undefined;
        };
        apiKeys: {
            enabled: {
                team: undefined;
                user: undefined;
            };
        };
        domains: {
            allowLocalhost: undefined;
        };
        auth: {
            allowSignUp: undefined;
            password: {
                allowSignIn: undefined;
            };
            otp: {
                allowSignIn: undefined;
            };
            passkey: {
                allowSignIn: undefined;
            };
            oauth: {
                accountMergeStrategy: undefined;
                providers: undefined;
            };
        };
        emails: {};
    };
}, "">;
declare const projectConfigDefaults: {};
declare const branchConfigDefaults: {};
declare const environmentConfigDefaults: {};
declare const organizationConfigDefaults: {
    rbac: {
        permissions: (key: string) => {};
        defaultPermissions: {
            teamCreator: {};
            teamMember: {};
            signUp: {};
        };
    };
    apiKeys: {
        enabled: {
            team: false;
            user: false;
        };
    };
    teams: {
        createPersonalTeamOnSignUp: false;
        allowClientTeamCreation: false;
    };
    users: {
        allowClientUserDeletion: false;
    };
    domains: {
        allowLocalhost: false;
        trustedDomains: (key: string) => {
            handlerPath: string;
        };
    };
    auth: {
        allowSignUp: true;
        password: {
            allowSignIn: false;
        };
        otp: {
            allowSignIn: false;
        };
        passkey: {
            allowSignIn: false;
        };
        oauth: {
            accountMergeStrategy: "link_method";
            providers: (key: string) => {
                isShared: true;
                allowSignIn: false;
                allowConnectedAccounts: false;
            };
        };
    };
    emails: {
        server: {
            isShared: true;
        };
    };
};
type DeepReplaceAllowFunctionsForObjects<T> = T extends object ? {
    [K in keyof T]: DeepReplaceAllowFunctionsForObjects<T[K]>;
} | ((arg: keyof T) => DeepReplaceAllowFunctionsForObjects<T[keyof T]>) : T;
type DeepReplaceFunctionsWithObjects<T> = T extends (arg: infer K extends string) => infer R ? DeepReplaceFunctionsWithObjects<Record<K, R>> : (T extends object ? {
    [K in keyof T]: DeepReplaceFunctionsWithObjects<T[K]>;
} : T);
type ApplyDefaults<D extends object | ((key: string) => unknown), C extends object> = DeepMerge<DeepReplaceFunctionsWithObjects<D>, C>;
declare function applyDefaults<D extends object | ((key: string) => unknown), C extends object>(defaults: D, config: C): ApplyDefaults<D, C>;
type ProjectConfigNormalizedOverride = yup.InferType<typeof projectConfigSchema>;
type BranchConfigNormalizedOverride = yup.InferType<typeof branchConfigSchema>;
type EnvironmentConfigNormalizedOverride = yup.InferType<typeof environmentConfigSchema>;
type OrganizationConfigNormalizedOverride = yup.InferType<typeof organizationConfigSchema>;
type ProjectConfigStrippedNormalizedOverride = Omit<ProjectConfigNormalizedOverride, keyof BranchConfigNormalizedOverride | keyof EnvironmentConfigNormalizedOverride | keyof OrganizationConfigNormalizedOverride>;
type BranchConfigStrippedNormalizedOverride = Omit<BranchConfigNormalizedOverride, keyof EnvironmentConfigNormalizedOverride | keyof OrganizationConfigNormalizedOverride>;
type EnvironmentConfigStrippedNormalizedOverride = Omit<EnvironmentConfigNormalizedOverride, keyof OrganizationConfigNormalizedOverride>;
type OrganizationConfigStrippedNormalizedOverride = OrganizationConfigNormalizedOverride;
type ProjectConfigOverride = NormalizesTo<ProjectConfigNormalizedOverride>;
type BranchConfigOverride = NormalizesTo<BranchConfigNormalizedOverride>;
type EnvironmentConfigOverride = NormalizesTo<EnvironmentConfigNormalizedOverride>;
type OrganizationConfigOverride = NormalizesTo<OrganizationConfigNormalizedOverride>;
type ProjectConfigOverrideOverride = Config & DeepPartial<ProjectConfigOverride>;
type BranchConfigOverrideOverride = Config & DeepPartial<BranchConfigOverride>;
type EnvironmentConfigOverrideOverride = Config & DeepPartial<EnvironmentConfigOverride>;
type OrganizationConfigOverrideOverride = Config & DeepPartial<OrganizationConfigOverride>;
type ProjectIncompleteConfig = ProjectConfigNormalizedOverride;
type BranchIncompleteConfig = ProjectIncompleteConfig & BranchConfigNormalizedOverride;
type EnvironmentIncompleteConfig = BranchIncompleteConfig & EnvironmentConfigNormalizedOverride;
type OrganizationIncompleteConfig = EnvironmentIncompleteConfig & OrganizationConfigNormalizedOverride;
type ProjectRenderedConfig = PrettifyType<ApplyDefaults<typeof projectConfigDefaults, ProjectConfigStrippedNormalizedOverride>>;
type BranchRenderedConfig = PrettifyType<ProjectRenderedConfig & ApplyDefaults<typeof branchConfigDefaults, BranchConfigStrippedNormalizedOverride>>;
type EnvironmentRenderedConfig = PrettifyType<BranchRenderedConfig & ApplyDefaults<typeof environmentConfigDefaults, EnvironmentConfigStrippedNormalizedOverride>>;
type OrganizationRenderedConfig = PrettifyType<EnvironmentRenderedConfig & ApplyDefaults<typeof organizationConfigDefaults, OrganizationConfigStrippedNormalizedOverride>>;

export { type ApplyDefaults, type BranchConfigNormalizedOverride, type BranchConfigOverride, type BranchConfigOverrideOverride, type BranchConfigStrippedNormalizedOverride, type BranchIncompleteConfig, type BranchRenderedConfig, type ConfigLevel, type DeepReplaceAllowFunctionsForObjects, type DeepReplaceFunctionsWithObjects, type EnvironmentConfigNormalizedOverride, type EnvironmentConfigOverride, type EnvironmentConfigOverrideOverride, type EnvironmentConfigStrippedNormalizedOverride, type EnvironmentIncompleteConfig, type EnvironmentRenderedConfig, type OrganizationConfigNormalizedOverride, type OrganizationConfigOverride, type OrganizationConfigOverrideOverride, type OrganizationConfigStrippedNormalizedOverride, type OrganizationIncompleteConfig, type OrganizationRenderedConfig, type ProjectConfigNormalizedOverride, type ProjectConfigOverride, type ProjectConfigOverrideOverride, type ProjectConfigStrippedNormalizedOverride, type ProjectIncompleteConfig, type ProjectRenderedConfig, applyDefaults, branchConfigDefaults, branchConfigSchema, configLevels, environmentConfigDefaults, environmentConfigSchema, organizationConfigDefaults, organizationConfigSchema, projectConfigDefaults, projectConfigSchema };
