"use client";

import { useRef, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  PROFILE_DESCRIPTION_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  updateProfileSchema,
} from "~/lib/profile-validation";
import MemberAvatar from "../_dashboard-components/_home-components/member-avatar";

export default function ProfileForm({
  initialProfile,
}: {
  initialProfile: RouterOutputs["profile"]["get"];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [name, setName] = useState(profile.name ?? "");
  const [description, setDescription] = useState(profile.description ?? "");
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    description?: string;
  }>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const utils = api.useUtils();
  const router = useRouter();
  const save = api.profile.update.useMutation();
  const hasChanges =
    name !== (profile.name ?? "") ||
    description !== (profile.description ?? "");
  const descriptionLength = [...description].length;
  const inputClass =
    "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50 disabled:text-gray-500";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending || !hasChanges) return;
    setMessage("");
    setError("");
    const parsed = updateProfileSchema.safeParse({ name, description });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        name: fields.name?.[0],
        description: fields.description?.[0],
      });
      if (fields.name) nameRef.current?.focus();
      else descriptionRef.current?.focus();
      return;
    }
    setFieldErrors({});
    try {
      const updated = await save.mutateAsync(parsed.data);
      setProfile(updated);
      setName(updated.name ?? "");
      setDescription(updated.description ?? "");
      setMessage("Profile saved.");
      utils.profile.get.setData(undefined, updated);
      // Refresh cached names in member lists, posts, and acknowledgment lists.
      void utils.company.getCompanyPosts.invalidate();
      void utils.company.getPostAcknowledgments.invalidate();
      void utils.invitation.members.invalidate();
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save your profile. Please try again.",
      );
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center gap-3 border-b border-gray-200 pb-5">
        <MemberAvatar
          name={profile.name ?? profile.email ?? "Account"}
          image={profile.image}
        />
        <div className="min-w-0">
          <p className="font-medium break-words text-gray-900">
            {profile.name ?? "Your account"}
          </p>
          <p className="mt-1 text-sm break-all text-gray-500">
            {profile.email ?? "No email address"}
          </p>
        </div>
      </div>
      <form className="mt-6 space-y-5" noValidate onSubmit={handleSubmit}>
        <div>
          <label
            htmlFor="profile-name"
            className="text-sm font-medium text-gray-900"
          >
            Name
          </label>
          <input
            ref={nameRef}
            id="profile-name"
            name="name"
            autoComplete="name"
            required
            value={name}
            disabled={save.isPending}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={
              fieldErrors.name
                ? "profile-name-help profile-name-error"
                : "profile-name-help"
            }
            onChange={(event) => {
              setName(event.target.value);
              setFieldErrors((current) => ({ ...current, name: undefined }));
              setMessage("");
              setError("");
            }}
            className={inputClass}
          />
          <p id="profile-name-help" className="mt-1 text-xs text-gray-500">
            Shown on posts and in member lists. Up to {PROFILE_NAME_MAX_LENGTH}{" "}
            characters.
          </p>
          {fieldErrors.name && (
            <p
              id="profile-name-error"
              role="alert"
              className="mt-1 text-sm text-red-700"
            >
              {fieldErrors.name}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="profile-description"
            className="text-sm font-medium text-gray-900"
          >
            Description{" "}
            <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <textarea
            ref={descriptionRef}
            id="profile-description"
            name="description"
            rows={5}
            placeholder="A little about you and what you do."
            value={description}
            disabled={save.isPending}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={
              fieldErrors.description
                ? "profile-description-help profile-description-error"
                : "profile-description-help"
            }
            onChange={(event) => {
              setDescription(event.target.value);
              setFieldErrors((current) => ({
                ...current,
                description: undefined,
              }));
              setMessage("");
              setError("");
            }}
            className={`${inputClass} resize-y`}
          />
          <p
            id="profile-description-help"
            className={`mt-1 text-right text-xs ${descriptionLength > PROFILE_DESCRIPTION_MAX_LENGTH ? "text-red-700" : "text-gray-500"}`}
          >
            {descriptionLength}/{PROFILE_DESCRIPTION_MAX_LENGTH} characters
          </p>
          {fieldErrors.description && (
            <p
              id="profile-description-error"
              role="alert"
              className="mt-1 text-sm text-red-700"
            >
              {fieldErrors.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-5">
          <button
            type="submit"
            disabled={!hasChanges || save.isPending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            disabled={!hasChanges || save.isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setName(profile.name ?? "");
              setDescription(profile.description ?? "");
              setFieldErrors({});
              setMessage("");
              setError("");
            }}
          >
            Cancel
          </button>
          {message && (
            <p role="status" className="text-sm text-green-700">
              {message}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
