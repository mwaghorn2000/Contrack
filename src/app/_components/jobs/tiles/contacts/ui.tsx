// Tile UIs are client components, so the server can import a tile's
// definition (for its schema) without loading React hooks.
"use client";

import { useEffect, useRef } from "react";
import type { z } from "zod";
import type { contactsConfig } from ".";

type ContactsConfig = z.infer<typeof contactsConfig>;
type Contact = ContactsConfig["contacts"][number];

// A plain address: no "?", "&" or "#", which would add fields to the email.
const PLAIN_EMAIL = /^[^\s@?&#]+@[^\s@?&#]+$/;

const FIELDS = [
  ["name", "Name", 100, "text"],
  ["role", "Role", 100, "text"],
  ["phone", "Phone", 40, "tel"],
  ["email", "Email", 200, "email"],
] as const;

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

/** Lets the job's author set the site address, notes and contacts. */
export function ContactsTileEditor({
  config,
  onChange,
}: {
  config: ContactsConfig;
  onChange: (config: ContactsConfig) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // Where focus goes once the contacts change: a contact's id, or "add".
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(
        target === "add"
          ? "[data-add-contact]"
          : `[data-contact="${target}"] input`,
      )
      ?.focus();
  }, [config.contacts]);
  const setContact = (id: string, change: Partial<Contact>) =>
    onChange({
      ...config,
      contacts: config.contacts.map((contact) =>
        contact.id === id ? { ...contact, ...change } : contact,
      ),
    });

  return (
    <div ref={listRef} className="space-y-3 text-sm">
      <label className="block">
        <span className="font-medium">Address</span>
        <input
          maxLength={300}
          value={config.address}
          onChange={(event) =>
            onChange({ ...config, address: event.target.value })
          }
          placeholder="e.g. 1 George St, Sydney"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="font-medium">Site notes</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={config.notes}
          onChange={(event) =>
            onChange({ ...config, notes: event.target.value })
          }
          placeholder="Parking, access, gate codes…"
          className={inputClass}
        />
      </label>
      {config.contacts.map((contact, index) => (
        <fieldset
          key={contact.id}
          data-contact={contact.id}
          className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 p-3 sm:grid-cols-2"
        >
          <legend className="px-1 text-gray-600">Contact {index + 1}</legend>
          {FIELDS.map(([field, label, max, type]) => (
            <label key={field} className="block">
              <span className="text-gray-600">{label}</span>
              <input
                type={type}
                maxLength={max}
                value={contact[field]}
                onChange={(event) =>
                  setContact(contact.id, { [field]: event.target.value })
                }
                className={inputClass}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              // Keeps keyboard users' place: the next contact, else the
              // previous one, else the Add button.
              const neighbour =
                config.contacts[index + 1] ?? config.contacts[index - 1];
              focusNext.current = neighbour?.id ?? "add";
              onChange({
                ...config,
                contacts: config.contacts.filter(({ id }) => id !== contact.id),
              });
            }}
            aria-label={`Remove contact ${index + 1}`}
            className="justify-self-start text-red-700 underline"
          >
            Remove
          </button>
        </fieldset>
      ))}
      {config.contacts.length < 20 && (
        <button
          type="button"
          data-add-contact
          onClick={() => {
            const id = crypto.randomUUID();
            focusNext.current = id;
            onChange({
              ...config,
              contacts: [
                ...config.contacts,
                { id, name: "", role: "", phone: "", email: "" },
              ],
            });
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
        >
          Add contact
        </button>
      )}
    </div>
  );
}

/** Shows the site address with a map link, its notes, and the contacts. */
export function ContactsTileView({ config }: { config: ContactsConfig }) {
  const { address, notes } = config;
  const contacts = config.contacts.filter(
    (contact) => contact.name || contact.role || contact.phone || contact.email,
  );
  if (!address && !notes && contacts.length === 0)
    return (
      <p className="text-sm text-gray-500">No location or contacts yet.</p>
    );
  return (
    <div className="space-y-3 text-sm">
      {address && (
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="whitespace-pre-wrap">{address}</span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 underline"
          >
            Open in Maps
          </a>
        </p>
      )}
      {notes && <p className="whitespace-pre-wrap text-gray-700">{notes}</p>}
      {contacts.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-wrap gap-x-4 py-2">
              {contact.name && (
                <span className="font-medium">{contact.name}</span>
              )}
              {contact.role && (
                <span className="text-gray-500">{contact.role}</span>
              )}
              {contact.phone && <PhoneLink phone={contact.phone} />}
              {contact.email &&
                (PLAIN_EMAIL.test(contact.email) ? (
                  <a href={`mailto:${contact.email}`} className="underline">
                    {contact.email}
                  </a>
                ) : (
                  <span>{contact.email}</span>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A phone number as typed, linked to call it when it has digits. */
function PhoneLink({ phone }: { phone: string }) {
  // Only digits and "+" go in the link; the text stays as typed.
  const number = phone.replace(/[^\d+]/g, "");
  if (!/\d/.test(number)) return <span>{phone}</span>;
  return (
    <a href={`tel:${number}`} className="underline">
      {phone}
    </a>
  );
}
