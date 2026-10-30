import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import type { z } from "zod";
import { contactsTile, type contactsConfig } from ".";
import { ContactsTileEditor, ContactsTileView } from "./ui";

type Config = z.infer<typeof contactsConfig>;

/** The editor with its own state, as the builder holds it. */
function Editor() {
  const [config, setConfig] = useState<Config>(contactsTile.defaultConfig());
  return <ContactsTileEditor config={config} onChange={setConfig} />;
}

test("the editor sets the address, site notes and contacts", async () => {
  const user = userEvent.setup();
  render(<Editor />);

  await user.type(screen.getByLabelText("Address"), "1 George St, Sydney");
  await user.type(screen.getByLabelText("Site notes"), "Use gate B");
  await user.click(screen.getByRole("button", { name: "Add contact" }));
  await user.click(screen.getByRole("button", { name: "Add contact" }));
  const first = within(screen.getByRole("group", { name: "Contact 1" }));
  await user.type(first.getByLabelText("Name"), "Sam Site");
  await user.type(first.getByLabelText("Role"), "Site manager");
  await user.type(first.getByLabelText("Phone"), "0400 111 222");
  await user.type(first.getByLabelText("Email"), "sam@example.com");

  expect(screen.getByLabelText("Address")).toHaveProperty(
    "value",
    "1 George St, Sydney",
  );
  expect(first.getByLabelText("Phone")).toHaveProperty("value", "0400 111 222");
  expect(screen.getAllByRole("group", { name: /^Contact \d$/ })).toHaveLength(
    2,
  );
});

test("a contact can be removed", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "Add contact" }));
  await user.click(screen.getByRole("button", { name: "Add contact" }));
  await user.type(
    within(screen.getByRole("group", { name: "Contact 2" })).getByLabelText(
      "Name",
    ),
    "Kim",
  );

  await user.click(screen.getByRole("button", { name: "Remove contact 1" }));

  const left = screen.getAllByRole("group", { name: /^Contact \d$/ });
  expect(left).toHaveLength(1);
  expect(within(left[0]!).getByLabelText("Name")).toHaveProperty(
    "value",
    "Kim",
  );
});

test("the view links the address to a map and contacts to call or email", () => {
  render(
    <ContactsTileView
      config={{
        address: "1 George St, Sydney",
        notes: "Use gate B",
        contacts: [
          {
            id: "c-1",
            name: "Sam Site",
            role: "Site manager",
            phone: "+61 400 111 222",
            email: "sam@example.com",
          },
        ],
      }}
    />,
  );

  expect(screen.getByText("1 George St, Sydney")).toBeTruthy();
  const map = screen.getByRole("link", { name: "Open in Maps" });
  expect(map.getAttribute("href")).toBe(
    "https://www.google.com/maps/search/?api=1&query=1%20George%20St%2C%20Sydney",
  );
  expect(map.getAttribute("target")).toBe("_blank");
  expect(screen.getByText("Use gate B")).toBeTruthy();
  expect(screen.getByText("Sam Site")).toBeTruthy();
  expect(screen.getByText("Site manager")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "+61 400 111 222" }).getAttribute("href"),
  ).toBe("tel:+61400111222");
  expect(
    screen.getByRole("link", { name: "sam@example.com" }).getAttribute("href"),
  ).toBe("mailto:sam@example.com");
});

test("the view leaves out what hasn't been filled in", () => {
  const { unmount } = render(
    <ContactsTileView
      config={{
        address: "",
        notes: "",
        contacts: [{ id: "c-1", name: "Sam", role: "", phone: "", email: "" }],
      }}
    />,
  );
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("Sam")).toBeTruthy();
  unmount();

  render(
    <ContactsTileView config={{ address: "", notes: "", contacts: [] }} />,
  );
  expect(screen.getByText("No location or contacts yet.")).toBeTruthy();
});

test("only plain addresses and numbers become links", () => {
  render(
    <ContactsTileView
      config={{
        address: "",
        notes: "",
        contacts: [
          {
            id: "c-1",
            name: "Sam",
            role: "",
            phone: "ask at gate",
            // Would pre-fill other fields in the reader's mail app.
            email: "sam@example.com?cc=boss@example.com&subject=hi",
          },
          { id: "c-2", name: "", role: "", phone: "", email: "" },
        ],
      }}
    />,
  );

  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("ask at gate")).toBeTruthy();
  expect(
    screen.getByText("sam@example.com?cc=boss@example.com&subject=hi"),
  ).toBeTruthy();
  // The blank contact isn't shown at all.
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});

test("the map link opens safely in a new tab", () => {
  render(
    <ContactsTileView
      config={{ address: "1 George St", notes: "", contacts: [] }}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Open in Maps" }).getAttribute("rel"),
  ).toBe("noopener noreferrer");
});

test("adding a contact focuses it, and removing one keeps focus nearby", async () => {
  const user = userEvent.setup();
  render(<Editor />);

  await user.click(screen.getByRole("button", { name: "Add contact" }));
  const first = within(screen.getByRole("group", { name: "Contact 1" }));
  expect(document.activeElement).toBe(first.getByLabelText("Name"));
  await user.click(screen.getByRole("button", { name: "Add contact" }));

  await user.click(screen.getByRole("button", { name: "Remove contact 1" }));
  expect(document.activeElement).toBe(
    within(screen.getByRole("group", { name: "Contact 1" })).getByLabelText(
      "Name",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Remove contact 1" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Add contact" }),
  );
});

test("a tile holds at most 20 contacts", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  for (let i = 0; i < 20; i++)
    await user.click(screen.getByRole("button", { name: "Add contact" }));

  expect(screen.getAllByRole("group", { name: /^Contact \d+$/ })).toHaveLength(
    20,
  );
  expect(screen.queryByRole("button", { name: "Add contact" })).toBeNull();
});
