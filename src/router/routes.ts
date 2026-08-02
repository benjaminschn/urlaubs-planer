export const publicRoute = "/login";
export const defaultProtectedRoute = "/app";

const protectedRoutes = new Set(["/app", "/timeline", "/documents", "/trip"]);

export type AppRoute =
  | { kind: "login"; path: "/login" }
  | { kind: "protected"; path: string; known: boolean }
  | { kind: "invite_disabled"; path: "/invite" };

export function normalizePath(path: string): string {
  const withoutHash = path.startsWith("#") ? path.slice(1) : path.split("#", 1)[0] ?? "";
  const withoutQuery = withoutHash.split("?", 1)[0] ?? "";
  if (!withoutQuery || withoutQuery === "/") {
    return defaultProtectedRoute;
  }
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  const compact = withLeadingSlash.replace(/\/+/g, "/");
  if (compact.length > 1 && compact.endsWith("/")) {
    return compact.slice(0, -1);
  }
  return compact;
}

export function routeFromHash(hash: string): AppRoute {
  const rawPath = hash.startsWith("#") ? hash.slice(1) : hash;
  const path = normalizePath(rawPath);
  if (path === publicRoute) {
    return { kind: "login", path: publicRoute };
  }
  if (path === "/invite") {
    return { kind: "invite_disabled", path: "/invite" };
  }
  return { kind: "protected", path, known: protectedRoutes.has(path) };
}

export function safeRedirectTarget(path: string): string {
  const route = routeFromHash(path);
  if (route.kind === "protected" && route.known) {
    return route.path;
  }
  return defaultProtectedRoute;
}

export function hashForPath(path: string): string {
  const route = routeFromHash(path);
  if (route.kind === "login") {
    return `#${publicRoute}`;
  }
  if (route.kind === "invite_disabled") {
    return "#/invite";
  }
  return `#${route.path}`;
}

export function currentPathFromLocation(location: Pick<Location, "hash">): string {
  return routeFromHash(location.hash).path;
}
