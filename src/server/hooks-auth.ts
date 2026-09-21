import { getConfig } from "@/server/config";

/**
 * Shared-secret gate for hook/event intake. When `hooks.secret` is unset the
 * endpoint is open (local dev default); when set, requests must carry it as
 * the `x-airlock-key` header or `?key=` query param.
 */
export function hooksAuthorized(request: Request): boolean {
  const secret = getConfig().hooks.secret;
  if (!secret) return true;
  const url = new URL(request.url);
  const presented = request.headers.get("x-airlock-key") ?? url.searchParams.get("key");
  return presented === secret;
}
