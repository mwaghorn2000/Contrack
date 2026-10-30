import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import type { JobTile } from "./tiles/registry";
import TileBoard from "./tile-board";
import type { JobPerson } from "./tile-settings";

/** Renders one Text tile on a board, with the given people on the job. */
function Board({ people }: { people: JobPerson[] }) {
  const [tiles, setTiles] = useState<JobTile[]>([
    {
      id: "tile-1",
      type: "text",
      visibility: { mode: "everyone" },
      requiresAcknowledgment: false,
      config: { body: "" },
    },
  ]);
  return <TileBoard tiles={tiles} people={people} onChange={setTiles} />;
}

test("a tile can be limited to chosen job members", async () => {
  const user = userEvent.setup();
  render(
    <Board
      people={[
        { id: "user-1", name: "Ada" },
        { id: "user-2", name: "Jaxon" },
      ]}
    />,
  );
  expect(screen.getByText("Everyone")).toBeTruthy();

  const settings = screen.getByRole("button", {
    name: "Settings for Text tile 1",
  });
  await user.click(settings);
  expect(settings.getAttribute("aria-expanded")).toBe("true");
  await user.click(
    screen.getByRole("radio", { name: "Only selected members" }),
  );
  expect(screen.getByText("Admins only")).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "Jaxon" }));
  expect(screen.getByText("1 member")).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "Ada" }));
  expect(screen.getByText("2 members")).toBeTruthy();

  await user.click(screen.getByRole("radio", { name: "Everyone on the job" }));
  expect(screen.getByText("Everyone")).toBeTruthy();
  expect(
    screen.queryByRole("group", { name: "Members who can see this tile" }),
  ).toBeNull();
  // Limiting it again starts from nobody rather than the old list.
  await user.click(
    screen.getByRole("radio", { name: "Only selected members" }),
  );
  expect(screen.getByText("Admins only")).toBeTruthy();

  await user.click(settings);
  expect(settings.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("radio")).toBeNull();
});

test("limiting a tile asks for people when the job has none", async () => {
  const user = userEvent.setup();
  render(<Board people={[]} />);

  await user.click(
    screen.getByRole("button", { name: "Settings for Text tile 1" }),
  );
  await user.click(
    screen.getByRole("radio", { name: "Only selected members" }),
  );

  expect(screen.getByText("Add people to the job first.")).toBeTruthy();
  expect(
    screen.getByText("Company owners and admins can always see every tile."),
  ).toBeTruthy();
});

test("a tile can ask the people who see it to acknowledge it", async () => {
  const user = userEvent.setup();
  render(<Board people={[{ id: "user-1", name: "Ada" }]} />);
  expect(screen.queryByText("Needs acknowledgment")).toBeNull();

  await user.click(
    screen.getByRole("button", { name: "Settings for Text tile 1" }),
  );
  const ask = screen.getByRole("checkbox", {
    name: "Ask people who can see it to acknowledge it",
  });
  await user.click(ask);

  expect(ask).toHaveProperty("checked", true);
  expect(screen.getByText("Needs acknowledgment")).toBeTruthy();
  // Not part of the visibility choices, for screen readers.
  expect(
    within(
      screen.getByRole("group", { name: "Who can see this tile" }),
    ).queryByRole("checkbox", { name: /acknowledge/ }),
  ).toBeNull();
});
