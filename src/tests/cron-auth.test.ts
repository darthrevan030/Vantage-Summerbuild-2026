import { describe, it, expect } from "vitest";
import { authorizeCron } from "@/lib/snapshots/cron-auth";

function req(headers: Record<string, string>): Request {
  return new Request("http://x/api/internal/snapshot-all", { headers });
}

describe("authorizeCron", () => {
  const secret = "s3cret";

  it("rejects when no secret is configured", () => {
    expect(authorizeCron(req({ "x-cron-secret": "s3cret" }), undefined)).toBe(false);
    expect(authorizeCron(req({ "x-cron-secret": "s3cret" }), "")).toBe(false);
  });

  it("accepts the x-cron-secret header", () => {
    expect(authorizeCron(req({ "x-cron-secret": secret }), secret)).toBe(true);
  });

  it("accepts the Vercel Authorization: Bearer form", () => {
    expect(authorizeCron(req({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
  });

  it("rejects a wrong or missing secret", () => {
    expect(authorizeCron(req({ "x-cron-secret": "nope" }), secret)).toBe(false);
    expect(authorizeCron(req({}), secret)).toBe(false);
  });
});
