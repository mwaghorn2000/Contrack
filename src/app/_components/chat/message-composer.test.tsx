import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createTestProvider } from "~/test/ui";
import MessageComposer from "./message-composer";

vi.mock("../uploads/image-upload-button", () => ({
  uploadImage: () => Promise.reject(new Error("Upload failed.")),
}));

test("gives the caption back when an image fails to send", async () => {
  const user = userEvent.setup();
  const { Wrapper } = createTestProvider(() => null);
  const { container } = render(
    <MessageComposer
      channelId="channel-1"
      placeholder="Message #general"
      onPending={() => undefined}
      onSent={() => undefined}
    />,
    { wrapper: Wrapper },
  );

  const textbox = screen.getByRole("textbox", { name: "Message" });
  await user.type(textbox, "Site photo");
  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error("No file input");
  await user.upload(
    fileInput,
    new File(["png"], "photo.png", { type: "image/png" }),
  );

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Upload failed.",
  );
  expect(textbox).toHaveProperty("value", "Site photo");
});
