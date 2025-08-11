// src/lib/stack-app/contact-channels/index.ts
function contactChannelCreateOptionsToCrud(userId, options) {
  return {
    value: options.value,
    type: options.type,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary,
    user_id: userId
  };
}
function contactChannelUpdateOptionsToCrud(options) {
  return {
    value: options.value,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary
  };
}
function serverContactChannelUpdateOptionsToCrud(options) {
  return {
    value: options.value,
    is_verified: options.isVerified,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary
  };
}
function serverContactChannelCreateOptionsToCrud(userId, options) {
  return {
    type: options.type,
    value: options.value,
    is_verified: options.isVerified,
    user_id: userId,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary
  };
}
export {
  contactChannelCreateOptionsToCrud,
  contactChannelUpdateOptionsToCrud,
  serverContactChannelCreateOptionsToCrud,
  serverContactChannelUpdateOptionsToCrud
};
//# sourceMappingURL=index.js.map