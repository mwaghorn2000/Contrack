import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createTestProvider, textMessage } from "~/test/ui";
import MessageItem from "./message-item";

// jsdom can't evaluate media queries, so this checks the class that shows
// the actions on devices without hover.
test("message actions stay visible on touch devices", () => {
  const { Wrapper } = createTestProvider(() => null);
  render(
    <MessageItem
      message={textMessage("m1")}
      compact={false}
      own
      canEdit
      canDelete
    />,
    { wrapper: Wrapper },
  );

  const actions = screen.getByRole("button", {
    name: "Edit message",
  }).parentElement;
  expect(actions?.className).toContain("[@media(hover:none)]:opacity-100");
});
