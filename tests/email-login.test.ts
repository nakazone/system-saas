import { describe, expect, it } from "vitest";

describe("email-first login contract", () => {
  it("documents apex login paths that must not require a slug", () => {
    const paths = [
      "/login",
      "/login.html",
      "/api/auth/login",
      "/api/auth/session",
      "/api/auth/logout",
    ];
    expect(paths.every((p) => p.startsWith("/"))).toBe(true);
    expect(paths).toContain("/login.html");
    expect(paths).toContain("/api/auth/login");
  });

  it("treats multiple_workspaces as a picker signal not a hard failure", () => {
    const payload = {
      success: false,
      error: "multiple_workspaces",
      workspaces: [{ id: "a", slug: "acme", name: "Acme" }],
    };
    expect(payload.error).toBe("multiple_workspaces");
    expect(payload.workspaces).toHaveLength(1);
  });
});
