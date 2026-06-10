"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Phase = "idle" | "loading" | "sent" | "oauth" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = createClient();
  const callbackUrl = () => `${window.location.origin}/auth/callback`;

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPhase("loading");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl() },
    });

    if (error) {
      setErrorMsg(error.message);
      setPhase("error");
    } else {
      setPhase("sent");
    }
  }

  async function handleGoogle() {
    setPhase("oauth");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) {
      setErrorMsg(error.message);
      setPhase("error");
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{ width: "100%", maxWidth: "400px" }}>

        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div style={{
            fontFamily: "var(--serif)",
            fontSize: "28px",
            color: "var(--gold)",
            letterSpacing: ".4px",
            textShadow: "0 0 32px var(--accent-glow)",
            lineHeight: 1,
          }}>
            Portfolio
          </div>
          <div style={{
            fontSize: "9px",
            letterSpacing: ".22em",
            color: "var(--text-muted)",
            marginTop: "4px",
            fontWeight: 500,
            textTransform: "uppercase",
          }}>
            Personal Wealth Terminal
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--r-card)",
          padding: "32px",
          boxShadow: "var(--card-shadow)",
        }}>
          {phase === "sent" ? (
            /* ── Success state ── */
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: "48px", height: "48px",
                borderRadius: "50%",
                background: "var(--accent-wash)",
                border: "1px solid var(--border-gold)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px",
                fontSize: "22px",
              }}>
                ✉
              </div>
              <div style={{
                fontFamily: "var(--serif)",
                fontSize: "18px",
                color: "var(--text-primary)",
                marginBottom: "10px",
              }}>
                Check your inbox
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                We sent a sign-in link to<br />
                <span style={{ color: "var(--gold)", fontFamily: "var(--mono)", fontSize: "12px" }}>
                  {email}
                </span>
              </div>
              <button
                onClick={() => { setPhase("idle"); setEmail(""); }}
                style={{
                  marginTop: "24px",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "24px" }}>
                <div style={{
                  fontFamily: "var(--serif)",
                  fontSize: "20px",
                  color: "var(--text-primary)",
                  marginBottom: "6px",
                }}>
                  Sign in
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  Access your portfolio dashboard
                </div>
              </div>

              {/* Google OAuth */}
              <button
                onClick={handleGoogle}
                disabled={phase === "loading" || phase === "oauth"}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "10px",
                  padding: "11px 14px",
                  color: phase === "oauth" ? "var(--text-muted)" : "var(--text-primary)",
                  fontFamily: "var(--ui)",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: phase === "loading" || phase === "oauth" ? "not-allowed" : "pointer",
                  transition: "border-color .15s, color .15s",
                  marginBottom: "16px",
                }}
                onMouseEnter={e => { if (phase === "idle") (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-gold)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-subtle)"; }}
              >
                <GoogleIcon />
                {phase === "oauth" ? "Redirecting…" : "Continue with Google"}
              </button>

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
                <span style={{ fontSize: "11px", color: "var(--text-muted)", letterSpacing: ".08em" }}>or</span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-subtle)" }} />
              </div>

              {/* Magic link form */}
              <form onSubmit={handleMagicLink}>
                <label style={{
                  display: "block",
                  fontSize: "11px",
                  letterSpacing: ".06em",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                  fontWeight: 500,
                }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={phase === "loading" || phase === "oauth"}
                  style={{
                    width: "100%",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "10px",
                    padding: "11px 14px",
                    color: "var(--text-primary)",
                    fontFamily: "var(--mono)",
                    fontSize: "13px",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color .15s",
                  }}
                  onFocus={e => (e.target.style.borderColor = "var(--border-gold)")}
                  onBlur={e => (e.target.style.borderColor = "var(--border-subtle)")}
                />

                <button
                  type="submit"
                  disabled={phase === "loading" || phase === "oauth" || !email.trim()}
                  style={{
                    marginTop: "12px",
                    width: "100%",
                    background: phase === "loading"
                      ? "var(--accent-tint)"
                      : "var(--accent-wash)",
                    border: "1px solid var(--border-gold)",
                    borderRadius: "10px",
                    padding: "11px 14px",
                    color: phase === "loading" ? "var(--text-secondary)" : "var(--gold)",
                    fontFamily: "var(--ui)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: phase === "loading" || phase === "oauth" || !email.trim() ? "not-allowed" : "pointer",
                    letterSpacing: ".03em",
                    transition: "background .15s, color .15s",
                  }}
                >
                  {phase === "loading" ? "Sending…" : "Send magic link"}
                </button>
              </form>

              {/* Error */}
              {phase === "error" && errorMsg && (
                <div style={{
                  marginTop: "16px",
                  padding: "10px 14px",
                  background: "rgba(255,111,139,0.08)",
                  border: "1px solid rgba(255,111,139,0.22)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "var(--loss)",
                  lineHeight: 1.5,
                }}>
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          textAlign: "center",
          marginTop: "24px",
          fontSize: "11px",
          color: "var(--text-muted)",
        }}>
          Personal finance dashboard — data stays private
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
