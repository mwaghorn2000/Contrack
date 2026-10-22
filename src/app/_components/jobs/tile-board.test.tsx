import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { JobTile } from "~/lib/job-tiles";
import TileBoard from "./tile-board";

/** A Text tile holding `body`. */
function tile(id: string, body: string): JobTile {
  return {
    id,
    type: "text",
    visibility: { mode: "everyone" },
    config: { body },
  };
}

/** Renders the board with its own tile state, as the builder does. */
function Board({ initial }: { initial: JobTile[] }) {
  const [tiles, setTiles] = useState(initial);
  return <TileBoard tiles={tiles} people={[]} onChange={setTiles} />;
}

/** The tile bodies in canvas order. */
function bodies() {
  return screen
    .getAllByLabelText("Text")
    .map((box) => (box as HTMLTextAreaElement).value);
}

afterEach(() => vi.restoreAllMocks());

test("clicking a palette tile adds it to the end", async () => {
  const user = userEvent.setup();
  render(<Board initial={[tile("a", "First")]} />);

  await user.click(screen.getByRole("button", { name: "Add Text tile" }));

  expect(bodies()).toEqual(["First", ""]);
});

test("removing a tile leaves the others in order", async () => {
  const user = userEvent.setup();
  render(
    <Board
      initial={[tile("a", "First"), tile("b", "Second"), tile("c", "Third")]}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Remove Text tile 2" }));

  expect(bodies()).toEqual(["First", "Third"]);
  expect(screen.getByRole("region", { name: "Text tile 2" })).toBeTruthy();
});

test("an empty canvas invites dropping tiles", () => {
  render(<Board initial={[]} />);
  expect(screen.getByText(/Drag tiles here/)).toBeTruthy();
});

test("a tile can be moved down with the keyboard", async () => {
  // jsdom has no layout, so stack the tiles 100px apart for dnd-kit to measure.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const position = /tile (\d+)$/.exec(
        this.getAttribute("aria-label") ?? "",
      );
      const top = position ? (Number(position[1]) - 1) * 100 : 0;
      const height = position ? 80 : 300;
      return DOMRect.fromRect({ x: 0, y: top, width: 400, height });
    },
  );
  const user = userEvent.setup();
  render(<Board initial={[tile("a", "First"), tile("b", "Second")]} />);

  const handle = within(
    screen.getByRole("region", { name: "Text tile 1" }),
  ).getByRole("button", { name: "Move Text tile 1" });
  act(() => handle.focus());
  await user.keyboard(" ");
  await user.keyboard("{ArrowDown}");
  await user.keyboard(" ");

  expect(bodies()).toEqual(["Second", "First"]);
});

test("drag instructions keep the same id on every render", () => {
  // The server and browser must agree on this id, or hydration fails.
  const describedBy = () =>
    screen
      .getByRole("button", { name: "Move Text tile 1" })
      .getAttribute("aria-describedby");
  const first = render(<Board initial={[tile("a", "First")]} />);
  const id = describedBy();
  first.unmount();
  render(<Board initial={[tile("a", "First")]} />);

  expect(describedBy()).toBe(id);
});

test("removing a tile moves focus to the next tile, or the one before", async () => {
  const user = userEvent.setup();
  render(
    <Board
      initial={[tile("a", "First"), tile("b", "Second"), tile("c", "Third")]}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Remove Text tile 2" }));
  // The third tile is now the second.
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Move Text tile 2" }),
  );

  await user.click(screen.getByRole("button", { name: "Remove Text tile 2" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Move Text tile 1" }),
  );
});
