// src/interface/adminInterface.ts
import { StackServerInterface } from "./serverInterface";
var StackAdminInterface = class extends StackServerInterface {
  constructor(options) {
    super(options);
    this.options = options;
  }
  async sendAdminRequest(path, options, session, requestType = "admin") {
    return await this.sendServerRequest(
      path,
      {
        ...options,
        headers: {
          "x-stack-super-secret-admin-key": "superSecretAdminKey" in this.options ? this.options.superSecretAdminKey : "",
          ...options.headers
        }
      },
      session,
      requestType
    );
  }
  async getProject() {
    const response = await this.sendAdminRequest(
      "/internal/projects/current",
      {
        method: "GET"
      },
      null
    );
    return await response.json();
  }
  async updateProject(update) {
    const response = await this.sendAdminRequest(
      "/internal/projects/current",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(update)
      },
      null
    );
    return await response.json();
  }
  async createInternalApiKey(options) {
    const response = await this.sendAdminRequest(
      "/internal/api-keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(options)
      },
      null
    );
    return await response.json();
  }
  async listInternalApiKeys() {
    const response = await this.sendAdminRequest("/internal/api-keys", {}, null);
    const result = await response.json();
    return result.items;
  }
  async revokeInternalApiKeyById(id) {
    await this.sendAdminRequest(
      `/internal/api-keys/${id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          revoked: true
        })
      },
      null
    );
  }
  async getInternalApiKey(id, session) {
    const response = await this.sendAdminRequest(`/internal/api-keys/${id}`, {}, session);
    return await response.json();
  }
  async listEmailTemplates() {
    const response = await this.sendAdminRequest(`/email-templates`, {}, null);
    const result = await response.json();
    return result.items;
  }
  async updateEmailTemplate(type, data) {
    const result = await this.sendAdminRequest(
      `/email-templates/${type}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await result.json();
  }
  async resetEmailTemplate(type) {
    await this.sendAdminRequest(
      `/email-templates/${type}`,
      { method: "DELETE" },
      null
    );
  }
  // Team permission definitions methods
  async listTeamPermissionDefinitions() {
    const response = await this.sendAdminRequest(`/team-permission-definitions`, {}, null);
    const result = await response.json();
    return result.items;
  }
  async createTeamPermissionDefinition(data) {
    const response = await this.sendAdminRequest(
      "/team-permission-definitions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async updateTeamPermissionDefinition(permissionId, data) {
    const response = await this.sendAdminRequest(
      `/team-permission-definitions/${permissionId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async deleteTeamPermissionDefinition(permissionId) {
    await this.sendAdminRequest(
      `/team-permission-definitions/${permissionId}`,
      { method: "DELETE" },
      null
    );
  }
  async listProjectPermissionDefinitions() {
    const response = await this.sendAdminRequest(`/project-permission-definitions`, {}, null);
    const result = await response.json();
    return result.items;
  }
  async createProjectPermissionDefinition(data) {
    const response = await this.sendAdminRequest(
      "/project-permission-definitions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async updateProjectPermissionDefinition(permissionId, data) {
    const response = await this.sendAdminRequest(
      `/project-permission-definitions/${permissionId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async deleteProjectPermissionDefinition(permissionId) {
    await this.sendAdminRequest(
      `/project-permission-definitions/${permissionId}`,
      { method: "DELETE" },
      null
    );
  }
  async getSvixToken() {
    const response = await this.sendAdminRequest(
      "/webhooks/svix-token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
    return await response.json();
  }
  async deleteProject() {
    await this.sendAdminRequest(
      "/internal/projects/current",
      {
        method: "DELETE"
      },
      null
    );
  }
  async getMetrics() {
    const response = await this.sendAdminRequest(
      "/internal/metrics",
      {
        method: "GET"
      },
      null
    );
    return await response.json();
  }
  async sendTestEmail(data) {
    const response = await this.sendAdminRequest(`/internal/send-test-email`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(data)
    }, null);
    return await response.json();
  }
  async listSentEmails() {
    const response = await this.sendAdminRequest("/internal/emails", {
      method: "GET"
    }, null);
    return await response.json();
  }
};
export {
  StackAdminInterface
};
//# sourceMappingURL=adminInterface.js.map