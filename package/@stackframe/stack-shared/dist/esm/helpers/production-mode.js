// src/helpers/production-mode.ts
import { StackAssertionError, captureError } from "../utils/errors";
import { isLocalhost } from "../utils/urls";
function getProductionModeErrors(project) {
  const errors = [];
  const domainsFixUrl = `/projects/${project.id}/domains`;
  if (project.config.allow_localhost) {
    errors.push({
      message: "Localhost is not allowed in production mode, turn off 'Allow localhost' in project settings",
      relativeFixUrl: domainsFixUrl
    });
  }
  for (const { domain } of project.config.domains) {
    let url;
    try {
      url = new URL(domain);
    } catch (e) {
      captureError("production-mode-domain-not-valid", new StackAssertionError("Domain was somehow not a valid URL; we should've caught this when setting the domain in the first place", {
        domain,
        projectId: project
      }));
      errors.push({
        message: "Trusted domain is not a valid URL: " + domain,
        relativeFixUrl: domainsFixUrl
      });
      continue;
    }
    if (isLocalhost(url)) {
      errors.push({
        message: "Localhost domains are not allowed to be trusted in production mode: " + domain,
        relativeFixUrl: domainsFixUrl
      });
    } else if (url.hostname.match(/^\d+(\.\d+)*$/)) {
      errors.push({
        message: "Direct IPs are not valid for trusted domains in production mode: " + domain,
        relativeFixUrl: domainsFixUrl
      });
    } else if (url.protocol !== "https:") {
      errors.push({
        message: "Trusted domains should be HTTPS: " + domain,
        relativeFixUrl: domainsFixUrl
      });
    }
  }
  return errors;
}
export {
  getProductionModeErrors
};
//# sourceMappingURL=production-mode.js.map