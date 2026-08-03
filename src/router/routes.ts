export const publicRoute = "/login";
export const defaultProtectedRoute = "/app";

const protectedRoutes = new Set(["/app", "/timeline", "/documents", "/trip"]);
const travelItemRoutePattern = /^\/events\/(new|[A-Za-z0-9-]+)(\/edit)?$/;
const candidateRoutePattern = /^\/candidates\/([A-Za-z0-9-]+)$/;

export type AppRoute =
  | { kind: "login"; path: "/login" }
  | { kind: "protected"; path: string; known: boolean }
  | { kind: "invite_disabled"; path: "/invite" };

export type TravelItemRoute =
  | { kind: "create"; path: string }
  | { kind: "detail"; path: string; itemId: string }
  | { kind: "edit"; path: string; itemId: string };

export type CandidateRoute = { kind: "review"; path: string; candidateId: string };

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
  return { kind: "protected", path, known: protectedRoutes.has(path) || travelItemRoutePattern.test(path) || candidateRoutePattern.test(path) };
}

export function candidateRouteFromPath(path: string): CandidateRoute | null {
  const normalized = normalizePath(path);
  const match = normalized.match(candidateRoutePattern);
  return match ? { kind: "review", path: normalized, candidateId: match[1] } : null;
}

export function travelItemRouteFromPath(path: string): TravelItemRoute | null {
  const normalized = normalizePath(path);
  const match = normalized.match(travelItemRoutePattern);
  if (!match) return null;
  if (match[1] === "new") return { kind: "create", path: normalized };
  return match[2]
    ? { kind: "edit", path: normalized, itemId: match[1] }
    : { kind: "detail", path: normalized, itemId: match[1] };
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
