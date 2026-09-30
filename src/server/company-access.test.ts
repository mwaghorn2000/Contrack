import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { withCompanyAccess } from "./company-access";

const { listCompanies } = vi.hoisted(() => ({
  listCompanies: vi.fn<() => Promise<{ id: string }[]>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/trpc/server", () => ({
  api: { company: { listCompanies } },
}));
vi.mock("next/navigation", () => ({
  // Next's redirect throws to stop rendering the inaccessible page.
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  listCompanies.mockReset();
  listCompanies.mockResolvedValue([]);
});

it("returns company page data when access is allowed", async () => {
  const company = { id: "allowed", name: "My company" };
  expect(
    await withCompanyAccess(company.id, () => Promise.resolve(company)),
  ).toBe(company);
  expect(listCompanies).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

it("redirects a removed member to another accessible company", async () => {
  listCompanies.mockResolvedValue([{ id: "remaining" }]);
  await expect(
    withCompanyAccess("removed", () =>
      Promise.reject(new TRPCError({ code: "NOT_FOUND" })),
    ),
  ).rejects.toThrow(
    "REDIRECT:/dashboard/home?notice=company-unavailable&companyId=remaining",
  );
});

it("redirects to join when the user has no remaining companies", async () => {
  await expect(
    withCompanyAccess("removed", () =>
      Promise.reject(new TRPCError({ code: "NOT_FOUND" })),
    ),
  ).rejects.toThrow("REDIRECT:/dashboard/join?notice=company-unavailable");
});

it("never redirects back to the unavailable company", async () => {
  listCompanies.mockResolvedValue([{ id: "removed" }]);
  await expect(
    withCompanyAccess("removed", () =>
      Promise.reject(new TRPCError({ code: "NOT_FOUND" })),
    ),
  ).rejects.toThrow("REDIRECT:/dashboard/join?notice=company-unavailable");
});

it("redirects an expired session to login", async () => {
  await expect(
    withCompanyAccess("removed", () =>
      Promise.reject(new TRPCError({ code: "UNAUTHORIZED" })),
    ),
  ).rejects.toThrow("REDIRECT:/login");
  expect(listCompanies).not.toHaveBeenCalled();
});

it("does not hide unrelated tRPC errors as lost company access", async () => {
  const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  await expect(
    withCompanyAccess("company", () => Promise.reject(error)),
  ).rejects.toBe(error);
  expect(listCompanies).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

it("does not hide unexpected page errors as lost company access", async () => {
  const error = new Error("Unexpected page failure");
  await expect(
    withCompanyAccess("company", () => Promise.reject(error)),
  ).rejects.toBe(error);
  expect(redirect).not.toHaveBeenCalled();
});

it("does not redirect to join when loading remaining companies fails", async () => {
  const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  listCompanies.mockRejectedValue(error);
  await expect(
    withCompanyAccess("removed", () =>
      Promise.reject(new TRPCError({ code: "NOT_FOUND" })),
    ),
  ).rejects.toBe(error);
  expect(redirect).not.toHaveBeenCalled();
});
