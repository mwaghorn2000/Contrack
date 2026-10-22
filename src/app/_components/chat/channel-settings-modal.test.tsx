import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { createTestProvider } from "~/test/ui";
import ChannelSettingsModal from "./channel-settings-modal";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// jsdom has no <dialog>.showModal(), so render the dialog's contents directly.
vi.mock("./chat-dialog", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const ALL = {
  canSendMessages: true,
  canManageMembers: true,
  canManageChannel: true,
  canModerateMessages: true,
};

const conversation = {
  id: "channel-1",
  kind: "CHANNEL" as const,
  name: "general",
  companyId: "company-1",
  imageUrl: null,
  permissions: { ...ALL, canManageChannel: false },
  directUser: null,
};

/** A company member row as listMembers returns it. */
function member(id: string, name: string) {
  return {
    role: "MEMBER" as const,
    user: { id, name, image: null },
    permissions: ALL,
  };
}

test("changing a permission doesn't disable or clear the other checkboxes", async () => {
  const user = userEvent.setup();
  const { Wrapper } = createTestProvider((path) => {
    if (path === "channel.listMembers")
      return [member("user-1", "Owner"), member("user-2", "Jaxon")];
    // Keep the save pending so the in-between state can be checked.
    if (path === "channel.setMember") return new Promise(() => undefined);
    return null;
  });
  render(
    <ChannelSettingsModal
      conversation={conversation}
      currentUserId="user-1"
      isCompanyOwner
      onClose={() => undefined}
    />,
    { wrapper: Wrapper },
  );

  const jaxon = (await screen.findByText("Jaxon")).closest("li");
  if (!jaxon) throw new Error("No member row");
  await user.click(within(jaxon).getByRole("checkbox", { name: "Moderate" }));

  const boxes = screen.getAllByRole("checkbox");
  expect(boxes.filter((box) => box.hasAttribute("disabled"))).toEqual([]);
  expect(
    within(jaxon).getByRole("checkbox", { name: "Moderate" }),
  ).toHaveProperty("checked", false);
  expect(
    boxes.filter((box) => !(box as HTMLInputElement).checked),
  ).toHaveLength(1);
});

test("a finished save doesn't undo a later click that is still saving", async () => {
  const user = userEvent.setup();
  const saves: (() => void)[] = [];
  let listCalls = 0;
  const { Wrapper } = createTestProvider((path) => {
    if (path === "channel.listMembers") {
      listCalls += 1;
      return [member("user-1", "Owner"), member("user-2", "Jaxon")];
    }
    if (path === "channel.setMember")
      return new Promise<null>((resolve) => saves.push(() => resolve(null)));
    return null;
  });
  render(
    <ChannelSettingsModal
      conversation={conversation}
      currentUserId="user-1"
      isCompanyOwner
      onClose={() => undefined}
    />,
    { wrapper: Wrapper },
  );

  const jaxon = (await screen.findByText("Jaxon")).closest("li");
  if (!jaxon) throw new Error("No member row");
  const box = (name: string) => within(jaxon).getByRole("checkbox", { name });
  await user.click(box("Moderate"));
  await user.click(box("Edit channel"));
  // The second change waits for the first, so only one request is out.
  await waitFor(() => expect(saves).toHaveLength(1));

  const callsBefore = listCalls;
  saves[0]?.();
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(listCalls).toBe(callsBefore);
  expect(box("Moderate")).toHaveProperty("checked", false);
  expect(box("Edit channel")).toHaveProperty("checked", false);

  saves[1]?.();
  await waitFor(() => expect(listCalls).toBe(callsBefore + 1));
});
