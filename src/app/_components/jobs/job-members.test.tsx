import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { createTestProvider, type Handler } from "~/test/ui";
import JobMembers from "./job-members";

/** A company member row as invitation.members returns it. */
function member(id: string, name: string, role = "MEMBER") {
  return { role, user: { id, name, image: null } };
}

const people = [member("user-1", "Ada", "OWNER"), member("user-2", "Jaxon")];

/** Renders the members panel with its own selection state. */
function renderMembers(handler: Handler, initial: string[] = []) {
  const { Wrapper } = createTestProvider(handler);
  function Members() {
    const [memberIds, setMemberIds] = useState(initial);
    return (
      <JobMembers
        companyId="company-1"
        memberIds={memberIds}
        onChange={setMemberIds}
      />
    );
  }
  render(<Members />, { wrapper: Wrapper });
}

test("lists company members and counts who is selected", async () => {
  const user = userEvent.setup();
  const inputs: unknown[] = [];
  renderMembers(
    (path, input) => {
      inputs.push(input);
      return path === "invitation.members" ? people : null;
    },
    ["user-1"],
  );

  expect(screen.getByRole("status").textContent).toBe("Loading people…");
  const ada = await screen.findByRole("checkbox", { name: /Ada/ });
  expect(ada).toHaveProperty("checked", true);
  expect(screen.getByText("(1 selected)")).toBeTruthy();
  expect(inputs).toContainEqual({ companyId: "company-1" });

  await user.click(screen.getByRole("checkbox", { name: /Jaxon/ }));
  expect(screen.getByText("(2 selected)")).toBeTruthy();
  await user.click(ada);
  expect(ada).toHaveProperty("checked", false);
  expect(screen.getByText("(1 selected)")).toBeTruthy();
});

test("offers a retry when people can't be loaded", async () => {
  const user = userEvent.setup();
  let calls = 0;
  renderMembers(() => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return people;
  });

  expect(await screen.findByText("Couldn’t load people.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByRole("checkbox", { name: /Jaxon/ })).toBeTruthy();
});
