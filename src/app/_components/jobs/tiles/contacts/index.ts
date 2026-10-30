import { z } from "zod";
import { defineTile } from "../define-tile";
import { ContactsTileEditor, ContactsTileView } from "./ui";

export const contactsConfig = z.object({
  address: z.string().max(300),
  notes: z.string().max(1000),
  contacts: z
    .array(
      z.object({
        id: z.string().max(64),
        name: z.string().max(100),
        role: z.string().max(100),
        phone: z.string().max(40),
        email: z.string().max(200),
      }),
    )
    .max(20),
});

/** Where the job is, with a map link, and who to call about it. */
export const contactsTile = defineTile({
  type: "contacts",
  label: "Location & contacts",
  icon: "☎",
  hint: "Site address and people to call",
  config: contactsConfig,
  defaultConfig: () => ({ address: "", notes: "", contacts: [] }),
  Editor: ContactsTileEditor,
  View: ContactsTileView,
});
