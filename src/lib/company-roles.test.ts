import { expect, test } from "vitest";
import { isManagerRole } from "./company-roles";

test("owners and admins manage the company", () => {
  expect(isManagerRole("OWNER")).toBe(true);
  expect(isManagerRole("ADMIN")).toBe(true);
});

test("members, contractors and non-members don't", () => {
  expect(isManagerRole("MEMBER")).toBe(false);
  expect(isManagerRole("CONTRACTOR")).toBe(false);
  expect(isManagerRole(undefined)).toBe(false);
});
