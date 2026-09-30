import { expect, it } from "vitest";
import {
  authPath,
  invitationDestination,
  invitationToken,
} from "./invitation-links";

const token = "a".repeat(64);

it("preserves the invitation and email through signup login and verification", () => {
  for (const path of ["/signup", "/login", "/verify-email"] as const) {
    const url = new URL(
      authPath(path, token, "person+invite@example.com"),
      "https://example.com",
    );
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get("invite")).toBe(token);
    expect(url.searchParams.get("email")).toBe("person+invite@example.com");
  }
  expect(invitationDestination(token)).toBe(`/invite/${token}`);
});

it("preserves the invitation when verification email delivery fails", () => {
  const url = new URL(
    authPath("/verify-email", token, "person@example.com", { sendFailed: "1" }),
    "https://example.com",
  );
  expect(url.searchParams.get("invite")).toBe(token);
  expect(url.searchParams.get("sendFailed")).toBe("1");
});

it("never treats an arbitrary URL as the post-login destination", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/dashboard",
    "a".repeat(63),
    "a".repeat(65),
    "<script>",
  ]) {
    expect(invitationToken(value)).toBeUndefined();
    expect(invitationDestination(value)).toBe("/dashboard");
    expect(authPath("/signup", value)).toBe("/signup");
  }
});

it("keeps normal signup and login working without an invitation", () => {
  expect(authPath("/signup")).toBe("/signup");
  expect(authPath("/login")).toBe("/login");
  expect(invitationDestination()).toBe("/dashboard");
});
