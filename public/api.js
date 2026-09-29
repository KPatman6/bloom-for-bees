let csrfToken = null;

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const api = {
  setCsrf(token) {
    csrfToken = token || null;
  },

  async request(path, options) {
    const config = options || {};
    const method = config.method || "GET";
    const headers = { Accept: "application/json" };
    if (config.body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD"].includes(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;

    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers,
        body: config.body === undefined ? undefined : JSON.stringify(config.body),
        cache: "no-store"
      });
    } catch (_error) {
      throw new ApiError("The local server could not be reached. Make sure Bloom for Bees is running, then try again.", 0, "offline");
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    if (!response.ok) {
      throw new ApiError(payload.error || "Something went wrong. Please try again.", response.status, payload.code || "request_failed");
    }
    return payload;
  },

  session() {
    return this.request("/api/session");
  },

  authenticate(mode, details) {
    return this.request(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      body: details
    });
  },

  gardens() {
    return this.request("/api/garden");
  },

  createGarden(garden) {
    return this.request("/api/garden", { method: "POST", body: garden });
  },

  updateGarden(id, changes) {
    return this.request("/api/garden/" + encodeURIComponent(id), { method: "PUT", body: changes });
  },

  deleteGarden(id) {
    return this.request("/api/garden/" + encodeURIComponent(id), { method: "DELETE", body: {} });
  },

  settings() {
    return this.request("/api/settings");
  },

  saveSettings(settings) {
    return this.request("/api/settings", { method: "PUT", body: settings });
  },

  updateProfile(profile) {
    return this.request("/api/profile", { method: "PATCH", body: profile });
  },

  changePassword(currentPassword, newPassword) {
    return this.request("/api/auth/password", {
      method: "POST",
      body: { currentPassword: currentPassword, newPassword: newPassword }
    });
  },

  logout() {
    return this.request("/api/auth/logout", { method: "POST", body: {} });
  },

  deleteAccount(email) {
    return this.request("/api/account", { method: "DELETE", body: { confirmation: email } });
  }
};
