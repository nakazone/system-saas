/**
 * Belt and braces for tenant isolation: wraps a (tenant) transaction client so every read and
 * bulk write on a model also filters by `organizationId`.
 *
 * RLS already isolates tenants when the app connects as `app_user`, but a privileged database
 * role (superuser / BYPASSRLS) skips RLS — then a query without an explicit organization filter
 * would read every tenant. Use this in modules that handle money (payroll, finance).
 *
 * Only `where`-based calls are scoped (find*, count, aggregate, groupBy, updateMany, deleteMany).
 * Unique-key calls (update/delete by id) are left alone — load the row through a scoped find first.
 */
const SCOPED = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);

export function orgScoped<T extends object>(tx: T, organizationId: string): T {
  const modelCache = new Map<PropertyKey, unknown>();
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || prop.startsWith("$") || !value || typeof value !== "object") return value;
      if (typeof (value as Record<string, unknown>).findMany !== "function") return value;
      if (modelCache.has(prop)) return modelCache.get(prop);
      const model = new Proxy(value as Record<string, unknown>, {
        get(m, method, r) {
          const fn = Reflect.get(m, method, r);
          if (typeof method !== "string" || !SCOPED.has(method) || typeof fn !== "function") return fn;
          return (args?: Record<string, unknown>) =>
            (fn as (a: unknown) => unknown).call(m, {
              ...(args || {}),
              where: { ...((args?.where as Record<string, unknown>) || {}), organizationId },
            });
        },
      });
      modelCache.set(prop, model);
      return model;
    },
  });
}
