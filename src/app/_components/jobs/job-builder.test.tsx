import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import JobBuilder from "./job-builder";
import JobList from "./job-list";
import { JobsStoreProvider } from "./jobs-store";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());
afterEach(() => vi.unstubAllGlobals());

/** Renders the builder with the list beside it, sharing one empty store. */
function renderBuilder() {
  render(
    <JobsStoreProvider initialJobs={[]}>
      <JobBuilder companyId="company-1" />
      <JobList companyId="company-1" canManage />
    </JobsStoreProvider>,
  );
}

test("saving a job with Text tiles adds it to the list", async () => {
  const user = userEvent.setup();
  renderBuilder();

  await user.type(screen.getByLabelText("Name"), "  Roof inspection ");
  await user.type(screen.getByLabelText(/Description/), "North side");
  await user.click(screen.getByRole("button", { name: "Add Text tile" }));
  await user.click(screen.getByRole("button", { name: "Add Text tile" }));
  const first = within(screen.getByRole("region", { name: "Text tile 1" }));
  await user.type(first.getByLabelText("Text"), "Wear a harness");
  expect(first.getByLabelText("Text")).toHaveProperty(
    "value",
    "Wear a harness",
  );
  expect(
    within(screen.getByRole("region", { name: "Text tile 2" })).getByLabelText(
      "Text",
    ),
  ).toHaveProperty("value", "");
  await user.click(screen.getByRole("button", { name: "Save job" }));

  expect(push).toHaveBeenCalledWith("/dashboard/jobs?companyId=company-1");
  const card = screen.getByRole("article");
  expect(within(card).getByText("Roof inspection")).toBeTruthy();
  expect(within(card).getByText("North side")).toBeTruthy();
  expect(within(card).getByText("0 members · 2 tiles")).toBeTruthy();
});

test("Cancel goes back to the list", () => {
  renderBuilder();
  expect(
    screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
  ).toBe("/dashboard/jobs?companyId=company-1");
});

test("a job can't be saved without a name", async () => {
  const user = userEvent.setup();
  renderBuilder();

  const save = screen.getByRole("button", { name: "Save job" });
  expect(save).toHaveProperty("disabled", true);
  await user.type(screen.getByLabelText("Name"), "   ");
  expect(save).toHaveProperty("disabled", true);
  expect(screen.getByText("No jobs yet.")).toBeTruthy();
});

test("choosing a photo shows a preview and releases the old one", async () => {
  const user = userEvent.setup();
  // jsdom has no object URLs.
  let count = 0;
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => `blob:photo-${++count}`;
      static revokeObjectURL = revoke;
    },
  );
  renderBuilder();
  const input = screen.getByLabelText("Job photo", { selector: "input" });

  await user.upload(input, new File(["x"], "a.png", { type: "image/png" }));
  await user.upload(input, new File(["y"], "b.png", { type: "image/png" }));

  expect(
    screen.getByRole("img", { name: "Job photo" }).getAttribute("src"),
  ).toBe("blob:photo-2");
  // The replaced preview is released.
  expect(revoke).toHaveBeenCalledWith("blob:photo-1");
});
