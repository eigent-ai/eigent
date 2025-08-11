// src/config/schema.ts
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { get, has, isObjectLike, mapValues, set } from "../utils/objects";
var configLevels = ["project", "branch", "environment", "organization"];
var permissionRegex = /^\$?[a-z0-9_:]+$/;
var customPermissionRegex = /^[a-z0-9_:]+$/;
var projectConfigSchema = yupObject({});
var branchRbacDefaultPermissions = yupRecord(
  yupString().optional().matches(permissionRegex),
  yupBoolean().isTrue().optional()
).optional();
var branchRbacSchema = yupObject({
  permissions: yupRecord(
    yupString().optional().matches(customPermissionRegex),
    yupObject({
      description: yupString().optional(),
      scope: yupString().oneOf(["team", "project"]).optional(),
      containedPermissionIds: yupRecord(
        yupString().optional().matches(permissionRegex),
        yupBoolean().isTrue().optional()
      ).optional()
    }).optional()
  ).optional(),
  defaultPermissions: yupObject({
    teamCreator: branchRbacDefaultPermissions,
    teamMember: branchRbacDefaultPermissions,
    signUp: branchRbacDefaultPermissions
  }).optional()
}).optional();
var branchApiKeysSchema = yupObject({
  enabled: yupObject({
    team: yupBoolean().optional(),
    user: yupBoolean().optional()
  }).optional()
}).optional();
var branchAuthSchema = yupObject({
  allowSignUp: yupBoolean().optional(),
  password: yupObject({
    allowSignIn: yupBoolean().optional()
  }).optional(),
  otp: yupObject({
    allowSignIn: yupBoolean().optional()
  }).optional(),
  passkey: yupObject({
    allowSignIn: yupBoolean().optional()
  }).optional(),
  oauth: yupObject({
    accountMergeStrategy: yupString().oneOf(["link_method", "raise_error", "allow_duplicates"]).optional(),
    providers: yupRecord(
      yupString().optional().matches(permissionRegex),
      yupObject({
        type: yupString().oneOf(allProviders).optional(),
        allowSignIn: yupBoolean().optional(),
        allowConnectedAccounts: yupBoolean().optional()
      }).defined()
    ).optional()
  }).optional()
}).optional();
var branchDomain = yupObject({
  allowLocalhost: yupBoolean().optional()
}).optional();
var branchConfigSchema = projectConfigSchema.concat(yupObject({
  rbac: branchRbacSchema,
  teams: yupObject({
    createPersonalTeamOnSignUp: yupBoolean().optional(),
    allowClientTeamCreation: yupBoolean().optional()
  }).optional(),
  users: yupObject({
    allowClientUserDeletion: yupBoolean().optional()
  }).optional(),
  apiKeys: branchApiKeysSchema,
  domains: branchDomain,
  auth: branchAuthSchema,
  emails: yupObject({})
}));
var environmentConfigSchema = branchConfigSchema.concat(yupObject({
  auth: branchConfigSchema.getNested("auth").concat(yupObject({
    oauth: branchConfigSchema.getNested("auth").getNested("oauth").concat(yupObject({
      providers: yupRecord(
        yupString().optional().matches(permissionRegex),
        yupObject({
          type: yupString().oneOf(allProviders).optional(),
          isShared: yupBoolean().optional(),
          clientId: schemaFields.oauthClientIdSchema.optional(),
          clientSecret: schemaFields.oauthClientSecretSchema.optional(),
          facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
          microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
          allowSignIn: yupBoolean().optional(),
          allowConnectedAccounts: yupBoolean().optional()
        })
      ).optional()
    }).optional())
  })),
  emails: branchConfigSchema.getNested("emails").concat(yupObject({
    server: yupObject({
      isShared: yupBoolean().optional(),
      host: schemaFields.emailHostSchema.optional().nonEmpty(),
      port: schemaFields.emailPortSchema.optional(),
      username: schemaFields.emailUsernameSchema.optional().nonEmpty(),
      password: schemaFields.emailPasswordSchema.optional().nonEmpty(),
      senderName: schemaFields.emailSenderNameSchema.optional().nonEmpty(),
      senderEmail: schemaFields.emailSenderEmailSchema.optional().nonEmpty()
    })
  }).optional()),
  domains: branchConfigSchema.getNested("domains").concat(yupObject({
    trustedDomains: yupRecord(
      yupString().uuid().optional(),
      yupObject({
        baseUrl: schemaFields.urlSchema.optional(),
        handlerPath: schemaFields.handlerPathSchema.optional()
      })
    ).optional()
  }))
}));
var organizationConfigSchema = environmentConfigSchema.concat(yupObject({}));
var projectConfigDefaults = {};
var branchConfigDefaults = {};
var environmentConfigDefaults = {};
var organizationConfigDefaults = {
  rbac: {
    permissions: (key) => ({}),
    defaultPermissions: {
      teamCreator: {},
      teamMember: {},
      signUp: {}
    }
  },
  apiKeys: {
    enabled: {
      team: false,
      user: false
    }
  },
  teams: {
    createPersonalTeamOnSignUp: false,
    allowClientTeamCreation: false
  },
  users: {
    allowClientUserDeletion: false
  },
  domains: {
    allowLocalhost: false,
    trustedDomains: (key) => ({
      handlerPath: "/handler"
    })
  },
  auth: {
    allowSignUp: true,
    password: {
      allowSignIn: false
    },
    otp: {
      allowSignIn: false
    },
    passkey: {
      allowSignIn: false
    },
    oauth: {
      accountMergeStrategy: "link_method",
      providers: (key) => ({
        isShared: true,
        allowSignIn: false,
        allowConnectedAccounts: false
      })
    }
  },
  emails: {
    server: {
      isShared: true
    }
  }
};
function applyDefaults(defaults, config) {
  const res = typeof defaults === "function" ? {} : mapValues(defaults, (v) => typeof v === "function" ? {} : typeof v === "object" ? applyDefaults(v, {}) : v);
  for (const [key, mergeValue] of Object.entries(config)) {
    const baseValue = typeof defaults === "function" ? defaults(key) : has(defaults, key) ? get(defaults, key) : void 0;
    if (baseValue !== void 0) {
      if (isObjectLike(baseValue) && isObjectLike(mergeValue)) {
        set(res, key, applyDefaults(baseValue, mergeValue));
        continue;
      }
    }
    set(res, key, mergeValue);
  }
  return res;
}
export {
  applyDefaults,
  branchConfigDefaults,
  branchConfigSchema,
  configLevels,
  environmentConfigDefaults,
  environmentConfigSchema,
  organizationConfigDefaults,
  organizationConfigSchema,
  projectConfigDefaults,
  projectConfigSchema
};
//# sourceMappingURL=schema.js.map