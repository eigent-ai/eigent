"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/config/schema.ts
var schema_exports = {};
__export(schema_exports, {
  applyDefaults: () => applyDefaults,
  branchConfigDefaults: () => branchConfigDefaults,
  branchConfigSchema: () => branchConfigSchema,
  configLevels: () => configLevels,
  environmentConfigDefaults: () => environmentConfigDefaults,
  environmentConfigSchema: () => environmentConfigSchema,
  organizationConfigDefaults: () => organizationConfigDefaults,
  organizationConfigSchema: () => organizationConfigSchema,
  projectConfigDefaults: () => projectConfigDefaults,
  projectConfigSchema: () => projectConfigSchema
});
module.exports = __toCommonJS(schema_exports);
var schemaFields = __toESM(require("../schema-fields"));
var import_schema_fields = require("../schema-fields");
var import_oauth = require("../utils/oauth");
var import_objects = require("../utils/objects");
var configLevels = ["project", "branch", "environment", "organization"];
var permissionRegex = /^\$?[a-z0-9_:]+$/;
var customPermissionRegex = /^[a-z0-9_:]+$/;
var projectConfigSchema = (0, import_schema_fields.yupObject)({});
var branchRbacDefaultPermissions = (0, import_schema_fields.yupRecord)(
  (0, import_schema_fields.yupString)().optional().matches(permissionRegex),
  (0, import_schema_fields.yupBoolean)().isTrue().optional()
).optional();
var branchRbacSchema = (0, import_schema_fields.yupObject)({
  permissions: (0, import_schema_fields.yupRecord)(
    (0, import_schema_fields.yupString)().optional().matches(customPermissionRegex),
    (0, import_schema_fields.yupObject)({
      description: (0, import_schema_fields.yupString)().optional(),
      scope: (0, import_schema_fields.yupString)().oneOf(["team", "project"]).optional(),
      containedPermissionIds: (0, import_schema_fields.yupRecord)(
        (0, import_schema_fields.yupString)().optional().matches(permissionRegex),
        (0, import_schema_fields.yupBoolean)().isTrue().optional()
      ).optional()
    }).optional()
  ).optional(),
  defaultPermissions: (0, import_schema_fields.yupObject)({
    teamCreator: branchRbacDefaultPermissions,
    teamMember: branchRbacDefaultPermissions,
    signUp: branchRbacDefaultPermissions
  }).optional()
}).optional();
var branchApiKeysSchema = (0, import_schema_fields.yupObject)({
  enabled: (0, import_schema_fields.yupObject)({
    team: (0, import_schema_fields.yupBoolean)().optional(),
    user: (0, import_schema_fields.yupBoolean)().optional()
  }).optional()
}).optional();
var branchAuthSchema = (0, import_schema_fields.yupObject)({
  allowSignUp: (0, import_schema_fields.yupBoolean)().optional(),
  password: (0, import_schema_fields.yupObject)({
    allowSignIn: (0, import_schema_fields.yupBoolean)().optional()
  }).optional(),
  otp: (0, import_schema_fields.yupObject)({
    allowSignIn: (0, import_schema_fields.yupBoolean)().optional()
  }).optional(),
  passkey: (0, import_schema_fields.yupObject)({
    allowSignIn: (0, import_schema_fields.yupBoolean)().optional()
  }).optional(),
  oauth: (0, import_schema_fields.yupObject)({
    accountMergeStrategy: (0, import_schema_fields.yupString)().oneOf(["link_method", "raise_error", "allow_duplicates"]).optional(),
    providers: (0, import_schema_fields.yupRecord)(
      (0, import_schema_fields.yupString)().optional().matches(permissionRegex),
      (0, import_schema_fields.yupObject)({
        type: (0, import_schema_fields.yupString)().oneOf(import_oauth.allProviders).optional(),
        allowSignIn: (0, import_schema_fields.yupBoolean)().optional(),
        allowConnectedAccounts: (0, import_schema_fields.yupBoolean)().optional()
      }).defined()
    ).optional()
  }).optional()
}).optional();
var branchDomain = (0, import_schema_fields.yupObject)({
  allowLocalhost: (0, import_schema_fields.yupBoolean)().optional()
}).optional();
var branchConfigSchema = projectConfigSchema.concat((0, import_schema_fields.yupObject)({
  rbac: branchRbacSchema,
  teams: (0, import_schema_fields.yupObject)({
    createPersonalTeamOnSignUp: (0, import_schema_fields.yupBoolean)().optional(),
    allowClientTeamCreation: (0, import_schema_fields.yupBoolean)().optional()
  }).optional(),
  users: (0, import_schema_fields.yupObject)({
    allowClientUserDeletion: (0, import_schema_fields.yupBoolean)().optional()
  }).optional(),
  apiKeys: branchApiKeysSchema,
  domains: branchDomain,
  auth: branchAuthSchema,
  emails: (0, import_schema_fields.yupObject)({})
}));
var environmentConfigSchema = branchConfigSchema.concat((0, import_schema_fields.yupObject)({
  auth: branchConfigSchema.getNested("auth").concat((0, import_schema_fields.yupObject)({
    oauth: branchConfigSchema.getNested("auth").getNested("oauth").concat((0, import_schema_fields.yupObject)({
      providers: (0, import_schema_fields.yupRecord)(
        (0, import_schema_fields.yupString)().optional().matches(permissionRegex),
        (0, import_schema_fields.yupObject)({
          type: (0, import_schema_fields.yupString)().oneOf(import_oauth.allProviders).optional(),
          isShared: (0, import_schema_fields.yupBoolean)().optional(),
          clientId: schemaFields.oauthClientIdSchema.optional(),
          clientSecret: schemaFields.oauthClientSecretSchema.optional(),
          facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
          microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
          allowSignIn: (0, import_schema_fields.yupBoolean)().optional(),
          allowConnectedAccounts: (0, import_schema_fields.yupBoolean)().optional()
        })
      ).optional()
    }).optional())
  })),
  emails: branchConfigSchema.getNested("emails").concat((0, import_schema_fields.yupObject)({
    server: (0, import_schema_fields.yupObject)({
      isShared: (0, import_schema_fields.yupBoolean)().optional(),
      host: schemaFields.emailHostSchema.optional().nonEmpty(),
      port: schemaFields.emailPortSchema.optional(),
      username: schemaFields.emailUsernameSchema.optional().nonEmpty(),
      password: schemaFields.emailPasswordSchema.optional().nonEmpty(),
      senderName: schemaFields.emailSenderNameSchema.optional().nonEmpty(),
      senderEmail: schemaFields.emailSenderEmailSchema.optional().nonEmpty()
    })
  }).optional()),
  domains: branchConfigSchema.getNested("domains").concat((0, import_schema_fields.yupObject)({
    trustedDomains: (0, import_schema_fields.yupRecord)(
      (0, import_schema_fields.yupString)().uuid().optional(),
      (0, import_schema_fields.yupObject)({
        baseUrl: schemaFields.urlSchema.optional(),
        handlerPath: schemaFields.handlerPathSchema.optional()
      })
    ).optional()
  }))
}));
var organizationConfigSchema = environmentConfigSchema.concat((0, import_schema_fields.yupObject)({}));
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
  const res = typeof defaults === "function" ? {} : (0, import_objects.mapValues)(defaults, (v) => typeof v === "function" ? {} : typeof v === "object" ? applyDefaults(v, {}) : v);
  for (const [key, mergeValue] of Object.entries(config)) {
    const baseValue = typeof defaults === "function" ? defaults(key) : (0, import_objects.has)(defaults, key) ? (0, import_objects.get)(defaults, key) : void 0;
    if (baseValue !== void 0) {
      if ((0, import_objects.isObjectLike)(baseValue) && (0, import_objects.isObjectLike)(mergeValue)) {
        (0, import_objects.set)(res, key, applyDefaults(baseValue, mergeValue));
        continue;
      }
    }
    (0, import_objects.set)(res, key, mergeValue);
  }
  return res;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
});
//# sourceMappingURL=schema.js.map