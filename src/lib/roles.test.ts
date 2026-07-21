import { describe, it, expect } from "vitest";
import {
  ROLES,
  isAdminRole,
  isSuperadminRole,
  canDeleteRole,
  canSetRole,
} from "./roles";

describe("ROLES", () => {
  it("lists the three tiers in ascending order", () => {
    expect(ROLES).toEqual(["user", "admin", "superadmin"]);
  });
});

describe("isAdminRole", () => {
  it("is true for admin", () => {
    expect(isAdminRole("admin")).toBe(true);
  });

  it("is true for superadmin", () => {
    expect(isAdminRole("superadmin")).toBe(true);
  });

  it("is false for user", () => {
    expect(isAdminRole("user")).toBe(false);
  });

  it("is false for null", () => {
    expect(isAdminRole(null)).toBe(false);
  });

  it("is false for undefined", () => {
    expect(isAdminRole(undefined)).toBe(false);
  });

  it("is false for an unknown string", () => {
    expect(isAdminRole("owner")).toBe(false);
  });
});

describe("isSuperadminRole", () => {
  it("is true only for superadmin", () => {
    expect(isSuperadminRole("superadmin")).toBe(true);
  });

  it("is false for admin", () => {
    expect(isSuperadminRole("admin")).toBe(false);
  });

  it("is false for user", () => {
    expect(isSuperadminRole("user")).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(isSuperadminRole(null)).toBe(false);
    expect(isSuperadminRole(undefined)).toBe(false);
  });
});

describe("canDeleteRole", () => {
  it("lets a superadmin delete a user", () => {
    expect(canDeleteRole("superadmin", "user")).toBe(true);
  });

  it("lets a superadmin delete an admin", () => {
    expect(canDeleteRole("superadmin", "admin")).toBe(true);
  });

  it("lets a superadmin delete another superadmin", () => {
    expect(canDeleteRole("superadmin", "superadmin")).toBe(true);
  });

  it("lets an admin delete a plain user", () => {
    expect(canDeleteRole("admin", "user")).toBe(true);
  });

  it("blocks an admin from deleting another admin", () => {
    expect(canDeleteRole("admin", "admin")).toBe(false);
  });

  it("blocks an admin from deleting a superadmin", () => {
    expect(canDeleteRole("admin", "superadmin")).toBe(false);
  });

  it("blocks a plain user from deleting anyone", () => {
    expect(canDeleteRole("user", "user")).toBe(false);
    expect(canDeleteRole("user", "admin")).toBe(false);
    expect(canDeleteRole("user", "superadmin")).toBe(false);
  });
});

describe("canSetRole", () => {
  it("allows only superadmin to change roles", () => {
    expect(canSetRole("superadmin")).toBe(true);
  });

  it("blocks admin from changing roles", () => {
    expect(canSetRole("admin")).toBe(false);
  });

  it("blocks a plain user from changing roles", () => {
    expect(canSetRole("user")).toBe(false);
  });
});
