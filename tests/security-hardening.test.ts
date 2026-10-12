import { describe, expect, it, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  clearRateLimits,
  hit,
  loginBlockedFor,
  rateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  LOGIN_EMAIL_LIMIT,
} from "../src/lib/security/rate-limit.js";
import {
  isLeakedDefaultPassword,
  newPasswordProblem,
} from "../src/lib/auth/password-policy.js";
import {
  enforcePasswordChange,
  neutralisePublicInput,
  rejectCrossSiteWrites,
  securityHeaders,
} from "../src/middleware/security.js";
import {
  assertCanAssignRole,
  assertCanManageUser,
  assertCanSetPermissions,
} from "../src/lib/auth/user-admin-guard.js";
import { safeContentType } from "../src/lib/storage/index.js";
import type { SessionUser } from "../src/middleware/auth.js";

type FakeRes = Response & { statusCode: number; body: unknown; headers: Record<string, string>; redirectedTo?: string };

function fakeRes(): FakeRes {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    redirectedTo: undefined as string | undefined,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = String(v);
      return this;
    },
    removeHeader(k: string) {
      delete this.headers[k.toLowerCase()];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    type() {
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
    redirect(code: number, url: string) {
      this.statusCode = code;
      this.redirectedTo = url;
      return this;
    },
  };
  return res as unknown as FakeRes;
}

function fakeReq(p: Partial<Request> & { headers?: Record<string, string> }): Request {
  const headers = p.headers || {};
  return {
    method: "GET",
    path: "/",
    ip: "203.0.113.7",
    body: undefined,
    ...p,
    headers,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function run(mw: (req: Request, res: Response, next: NextFunction) => void, req: Request) {
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

const admin: SessionUser = {
  id: "a1",
  organizationId: "o1",
  email: "a@x.com",
  name: "A",
  roleKey: "admin",
  roleId: "r-admin",
  permissions: [],
};
const manager: SessionUser = {
  id: "m1",
  organizationId: "o1",
  email: "m@x.com",
  name: "M",
  roleKey: "general_manager",
  roleId: "r-gm",
  permissions: ["users.view", "users.edit", "users.manage", "leads.view"],
};

beforeEach(() => clearRateLimits());

describe("rate limiter", () => {
  it("allows up to the limit then blocks with retry seconds", () => {
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 60_000)).toBe(0);
    expect(hit("k", 3, 60_000)).toBeGreaterThan(0);
  });

  it("middleware answers 429 after the limit", () => {
    const mw = rateLimit({ name: "t", limit: 2, windowMs: 60_000 });
    const req = fakeReq({ path: "/api/x" });
    expect(run(mw, req).nextCalled).toBe(true);
    expect(run(mw, req).nextCalled).toBe(true);
    const third = run(mw, req);
    expect(third.nextCalled).toBe(false);
    expect(third.res.statusCode).toBe(429);
    expect(third.res.headers["retry-after"]).toBeTruthy();
  });

  it("locks an e-mail after repeated failures and clears on success", () => {
    const req = fakeReq({});
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) recordLoginFailure("s", req, "x@y.com");
    expect(loginBlockedFor("s", req, "X@Y.com")).toBeGreaterThan(0);
    recordLoginSuccess("s", "x@y.com");
    expect(loginBlockedFor("s", req, "x@y.com")).toBe(0);
  });
});

describe("password policy", () => {
  it("blocks the passwords published in the repository", () => {
    expect(isLeakedDefaultPassword("SeniorMigrate2026!")).toBe(true);
    expect(isLeakedDefaultPassword("changeme-platform-admin")).toBe(true);
    expect(isLeakedDefaultPassword("password12345")).toBe(true);
    expect(isLeakedDefaultPassword("a-real-Passw0rd!")).toBe(false);
  });

  it("rejects short, weak or e-mail-equal new passwords", () => {
    expect(newPasswordProblem("short")).toBeTruthy();
    expect(newPasswordProblem("12345678")).toBeTruthy();
    expect(newPasswordProblem("SeniorMigrate2026!")).toBeTruthy();
    expect(newPasswordProblem("joe@acme.com", { email: "joe@acme.com" })).toBeTruthy();
    expect(newPasswordProblem("Piso-Laminado-2026")).toBeNull();
  });
});

describe("security headers", () => {
  it("sets anti-framing, nosniff and referrer policy", () => {
    const { res, nextCalled } = run(securityHeaders, fakeReq({ path: "/dashboard" }));
    expect(nextCalled).toBe(true);
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("never sends a referrer from token links", () => {
    const { res } = run(securityHeaders, fakeReq({ path: "/public/quotes/abc" }));
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
  });
});

describe("cross-site write protection", () => {
  const mw = rejectCrossSiteWrites("obramate.com");

  it("blocks a cross-site POST", () => {
    const r = run(mw, fakeReq({ method: "POST", path: "/api/leads", headers: { "sec-fetch-site": "cross-site" } }));
    expect(r.nextCalled).toBe(false);
    expect(r.res.statusCode).toBe(403);
  });

  it("allows same-origin and same-site POSTs", () => {
    expect(run(mw, fakeReq({ method: "POST", path: "/api/leads", headers: { "sec-fetch-site": "same-origin" } })).nextCalled).toBe(true);
    expect(run(mw, fakeReq({ method: "POST", path: "/api/leads", headers: { "sec-fetch-site": "same-site" } })).nextCalled).toBe(true);
  });

  it("falls back to Origin when Sec-Fetch-Site is missing", () => {
    const bad = run(mw, fakeReq({ method: "POST", path: "/api/leads", headers: { origin: "https://evil.example", host: "obramate.com" } }));
    expect(bad.nextCalled).toBe(false);
    const sub = run(mw, fakeReq({ method: "POST", path: "/api/leads", headers: { origin: "https://acme.obramate.com", host: "obramate.com" } }));
    expect(sub.nextCalled).toBe(true);
    // Server-to-server (no Origin) keeps working.
    expect(run(mw, fakeReq({ method: "POST", path: "/api/leads", headers: {} })).nextCalled).toBe(true);
  });

  it("keeps the public lead intake open to landing pages", () => {
    const r = run(mw, fakeReq({ method: "POST", path: "/api/receive-lead", headers: { "sec-fetch-site": "cross-site" } }));
    expect(r.nextCalled).toBe(true);
  });
});

describe("public input neutralisation", () => {
  it("turns angle brackets in public text into harmless characters", () => {
    const req = fakeReq({
      method: "POST",
      path: "/api/receive-lead",
      body: { name: "<img src=x onerror=alert(1)>", nested: { msg: "a<b" }, list: ["<i>"] },
    });
    run(neutralisePublicInput, req);
    const b = req.body as { name: string; nested: { msg: string }; list: string[] };
    expect(b.name).not.toContain("<");
    expect(b.name).not.toContain(">");
    expect(b.nested.msg).toBe("a‹b");
    expect(b.list[0]).toBe("‹i›");
  });

  it("keeps passwords byte-exact and leaves private routes alone", () => {
    const invite = fakeReq({ method: "POST", path: "/invitations/tok", body: { name: "<b>", password: "p<ss>word!" } });
    run(neutralisePublicInput, invite);
    expect((invite.body as { password: string }).password).toBe("p<ss>word!");
    const crm = fakeReq({ method: "POST", path: "/api/leads", body: { name: "<b>" } });
    run(neutralisePublicInput, crm);
    expect((crm.body as { name: string }).name).toBe("<b>");
  });
});

describe("password change enforcement", () => {
  const userReq = (path: string, method = "GET") =>
    Object.assign(fakeReq({ path, method }), { user: { ...manager, mustChangePassword: true } });

  it("blocks APIs other than auth while a password change is pending", () => {
    const blocked = run(enforcePasswordChange as never, userReq("/api/customers"));
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.res.statusCode).toBe(403);
    expect(run(enforcePasswordChange as never, userReq("/api/auth/change-password", "POST")).nextCalled).toBe(true);
  });

  it("sends pages to the change-password screen", () => {
    const r = run(enforcePasswordChange as never, userReq("/dashboard"));
    expect(r.res.redirectedTo).toBe("/change-password.html");
    expect(run(enforcePasswordChange as never, userReq("/change-password.html")).nextCalled).toBe(true);
  });
});

describe("user administration guard", () => {
  it("lets an admin do anything", () => {
    expect(() => assertCanManageUser(admin, { id: "x", roleKey: "admin" })).not.toThrow();
    expect(() => assertCanAssignRole(admin, { key: "admin" })).not.toThrow();
    expect(() => assertCanSetPermissions(admin, admin.id, ["settings.manage"])).not.toThrow();
  });

  it("stops a manager from touching admins or becoming one", () => {
    expect(() => assertCanManageUser(manager, { id: "x", roleKey: "admin" })).toThrow();
    expect(() => assertCanAssignRole(manager, { key: "admin" })).toThrow();
    expect(() => assertCanManageUser(manager, { id: "y", roleKey: "installer" })).not.toThrow();
  });

  it("stops a manager from granting permissions they lack or editing their own", () => {
    expect(() => assertCanSetPermissions(manager, "y", ["settings.manage"])).toThrow();
    expect(() => assertCanSetPermissions(manager, manager.id, ["leads.view"])).toThrow();
    expect(() => assertCanSetPermissions(manager, "y", ["leads.view"])).not.toThrow();
  });
});

describe("upload content types", () => {
  it("keeps passive media types and downgrades active ones", () => {
    expect(safeContentType("image/png")).toBe("image/png");
    expect(safeContentType("image/jpg")).toBe("image/jpeg");
    expect(safeContentType("application/pdf")).toBe("application/pdf");
    expect(safeContentType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(safeContentType("text/html")).toBe("application/octet-stream");
    expect(safeContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(safeContentType("application/javascript")).toBe("application/octet-stream");
    expect(safeContentType(undefined)).toBe("application/octet-stream");
  });
});
