import { expect, test } from "vitest";
import { contactsConfig, contactsTile } from ".";

const contact = {
  id: "c-1",
  name: "Sam Site",
  role: "Site manager",
  phone: "+61 400 111 222",
  email: "sam@example.com",
};

test("a new Location & contacts tile starts empty and valid", () => {
  const config = contactsTile.defaultConfig();
  expect(config).toEqual({ address: "", notes: "", contacts: [] });
  expect(contactsConfig.parse(config)).toEqual(config);
});

test("the config accepts an address, notes and contacts", () => {
  const config = {
    address: "1 George St, Sydney",
    notes: "Gate B",
    contacts: [contact],
  };
  expect(contactsConfig.parse(config)).toEqual(config);
});

test("the config rejects oversized fields and too many contacts", () => {
  for (const config of [
    { address: "x".repeat(301), notes: "", contacts: [] },
    { address: "", notes: "x".repeat(1001), contacts: [] },
    {
      address: "",
      notes: "",
      contacts: [{ ...contact, name: "x".repeat(101) }],
    },
    {
      address: "",
      notes: "",
      contacts: [{ ...contact, phone: "x".repeat(41) }],
    },
    {
      address: "",
      notes: "",
      contacts: Array.from({ length: 21 }, (_, i) => ({
        ...contact,
        id: `c-${i}`,
      })),
    },
  ])
    expect(contactsConfig.safeParse(config).success).toBe(false);
});
