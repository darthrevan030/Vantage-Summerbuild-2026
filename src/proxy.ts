import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // framer-motion writes inline style attrs; nonce not applicable to style-src in this stack
    "style-src 'self' 'unsafe-inline'",
    // lh3.googleusercontent.com for Google OAuth profile avatars
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, nonce: string): void {
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains"
  );
}

export async function proxy(request: NextRequest) {
  // btoa + randomUUID produces valid base64 without a Node Buffer dependency
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // Inject nonce + CSP into request headers so:
  //   1. headers() in Server Components can read x-nonce
  //   2. Next.js auto-extracts the nonce from CSP and applies it to framework scripts
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("Content-Security-Policy", csp);

  // Must initialise supabaseResponse before createServerClient so setAll can
  // mutate it — the response reference is captured by closure.
  let supabaseResponse = NextResponse.next({ request: { headers: reqHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mirror onto request so downstream server components see fresh tokens.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Re-create with updated request + enriched headers so nonce propagates.
          const refreshedHeaders = new Headers(request.headers);
          refreshedHeaders.set("x-nonce", nonce);
          refreshedHeaders.set("Content-Security-Policy", csp);
          supabaseResponse = NextResponse.next({
            request: { headers: refreshedHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do NOT put any logic between createServerClient and getUser().
  // getUser() re-validates the session with Supabase and refreshes if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthPath =
    pathname.startsWith("/login") || pathname.startsWith("/auth");
  // The marketing landing page is public for signed-out visitors only.
  const isLanding = pathname === "/";

  if (!user && !isAuthPath && !isLanding) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    applySecurityHeaders(redirect, nonce);
    return redirect;
  }

  if (user && (pathname === "/login" || isLanding)) {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    const redirect = NextResponse.redirect(url);
    applySecurityHeaders(redirect, nonce);
    return redirect;
  }

  applySecurityHeaders(supabaseResponse, nonce);
  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
