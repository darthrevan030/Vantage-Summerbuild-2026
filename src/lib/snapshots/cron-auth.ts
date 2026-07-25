// Constant-time compare to avoid leaking secret length/content via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Accepts the secret as `x-cron-secret` (arbitrary callers) or as
// `Authorization: Bearer <secret>` (the form Vercel Cron injects).
export function authorizeCron(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get("x-cron-secret");
  if (header && safeEqual(header, secret)) return true;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer !== "" && safeEqual(bearer, secret);
}
