"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { api } from "~/trpc/react";

const profileFields = [
  {
    key: "image",
    label: "Photo URL",
    type: "url",
    placeholder: "https://example.com/logo.png",
    autoComplete: "off",
    maxLength: undefined,
  },
  {
    key: "email",
    label: "Email",
    type: "email",
    placeholder: "hello@company.com",
    autoComplete: "email",
    maxLength: 254,
  },
  {
    key: "website",
    label: "Website",
    type: "url",
    placeholder: "https://company.com",
    autoComplete: "url",
    maxLength: undefined,
  },
  {
    key: "phone",
    label: "Phone number",
    type: "tel",
    placeholder: "+61 2 1234 5678",
    autoComplete: "tel",
    maxLength: 20,
  },
] as const;

export default function CreateCompanyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (companyId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profile, setProfile] = useState({
    image: "",
    email: "",
    website: "",
    phone: "",
  });
  const [validationError, setValidationError] = useState("");
  const utils = api.useUtils();
  const createCompany = api.company.createCompany.useMutation({
    onSuccess(company) {
      utils.company.listCompanies.setData(undefined, (companies) => [
        ...(companies ?? []).filter((item) => item.id !== company.id),
        {
          id: company.id,
          name: company.name,
          image: company.image,
          description: company.description,
          members: [{ role: "OWNER" }],
        },
      ]);
      void utils.company.listCompanies.invalidate();
      onCreated(company.id);
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="create-company-title"
      aria-describedby="create-company-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!createCompany.isPending) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-xl backdrop:bg-black/40"
    >
      <h2 id="create-company-title" className="text-lg font-semibold">
        Create company
      </h2>
      <p id="create-company-description" className="mt-1 text-sm text-gray-500">
        You’ll be the owner of this company.
      </p>
      <form
        className="mt-6 space-y-4"
        aria-busy={createCompany.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (createCompany.isPending) return;
          if (!name.trim()) {
            setValidationError("Enter a company name.");
            return;
          }
          setValidationError("");
          createCompany.mutate({
            name: name.trim(),
            description: description.trim() || undefined,
            image: profile.image.trim() || undefined,
            email: profile.email.trim() || undefined,
            website: profile.website.trim() || undefined,
            phone: profile.phone.trim() || undefined,
          });
        }}
      >
        <div>
          <label htmlFor="company-name" className="block text-sm font-medium">
            Company name
          </label>
          <input
            id="company-name"
            name="name"
            autoComplete="organization"
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setValidationError("");
            }}
            disabled={createCompany.isPending}
            aria-invalid={Boolean(validationError)}
            aria-describedby={
              validationError ? "company-name-error" : undefined
            }
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50"
          />
          {validationError && (
            <p
              id="company-name-error"
              role="alert"
              className="mt-1 text-sm text-red-600"
            >
              {validationError}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="company-description"
            className="block text-sm font-medium"
          >
            Description{" "}
            <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <textarea
            id="company-description"
            name="description"
            rows={3}
            maxLength={300}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={createCompany.isPending}
            className="mt-1 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50"
          />
        </div>
        {profileFields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`company-${field.key}`}
              className="block text-sm font-medium"
            >
              {field.label}{" "}
              <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id={`company-${field.key}`}
              name={field.key}
              type={field.type}
              autoComplete={field.autoComplete}
              placeholder={field.placeholder}
              maxLength={field.maxLength}
              value={profile[field.key]}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))
              }
              disabled={createCompany.isPending}
              aria-describedby={
                field.key === "image" ? "company-image-help" : undefined
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50"
            />
            {field.key === "image" && (
              <p id="company-image-help" className="mt-1 text-xs text-gray-500">
                Paste a link to your company photo or logo.
              </p>
            )}
          </div>
        ))}
        {createCompany.isError && (
          <div role="alert" className="text-sm text-red-600">
            {createCompany.error.data?.code === "UNAUTHORIZED" ? (
              <>
                <p>Your session is no longer valid. Please sign in again.</p>
                <Link
                  href="/login"
                  className="mt-1 inline-block rounded font-medium underline"
                >
                  Sign in again
                </Link>
              </>
            ) : (
              <p>Couldn’t create the company. Please try again.</p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={createCompany.isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createCompany.isPending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {createCompany.isPending ? "Creating…" : "Create company"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
