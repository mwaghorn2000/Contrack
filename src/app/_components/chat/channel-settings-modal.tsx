"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import ImageUploadButton, { uploadImage } from "../uploads/image-upload-button";
import ChannelIcon from "./channel-icon";
import ChatDialog from "./chat-dialog";
import PersonLabel from "./person-label";

type Conversation = RouterOutputs["channel"]["getChannel"];
type Permissions = Conversation["permissions"];

const PERMISSION_LABELS: [keyof Permissions, string][] = [
  ["canSendMessages", "Send messages"],
  ["canManageMembers", "Manage members"],
  ["canManageChannel", "Edit channel"],
  ["canModerateMessages", "Moderate"],
];

const SEND_ONLY: Permissions = {
  canSendMessages: true,
  canManageMembers: false,
  canManageChannel: false,
  canModerateMessages: false,
};

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50";

export default function ChannelSettingsModal({
  conversation,
  currentUserId,
  isCompanyOwner,
  onClose,
}: {
  conversation: Conversation;
  currentUserId: string;
  isCompanyOwner: boolean;
  onClose: () => void;
}) {
  const channelId = conversation.id;
  const { permissions } = conversation;
  const router = useRouter();
  const utils = api.useUtils();
  const refresh = () => {
    void utils.channel.getChannel.invalidate({ channelId });
    void utils.channel.listChannels.invalidate();
  };
  const update = api.channel.updateChannel.useMutation({ onSuccess: refresh });
  const createUpload = api.channel.createImageUpload.useMutation();
  const setImage = api.channel.setImage.useMutation({ onSuccess: refresh });
  const remove = api.channel.deleteChannel.useMutation({
    onSuccess() {
      void utils.channel.listChannels.invalidate();
      onClose();
      router.push(
        `/dashboard/chat?${new URLSearchParams({ companyId: conversation.companyId })}`,
      );
    },
  });
  const busy = update.isPending || remove.isPending;

  return (
    <ChatDialog
      title="Channel settings"
      description={`#${conversation.name}`}
      busy={busy}
      onClose={onClose}
      wide
    >
      <div className="space-y-8">
        {permissions.canManageChannel && (
          <DetailsSection
            conversation={conversation}
            busy={busy}
            update={update}
            onUpload={(file) =>
              uploadImage(file, "logo", {
                create: (details) =>
                  createUpload.mutateAsync({ channelId, ...details }),
                confirm: (key) => setImage.mutateAsync({ channelId, key }),
              })
            }
            onRemoveImage={() => setImage.mutateAsync({ channelId, key: null })}
          />
        )}

        {permissions.canManageMembers && (
          <MembersSection
            channelId={channelId}
            currentUserId={currentUserId}
            isCompanyOwner={isCompanyOwner}
            ownPermissions={permissions}
          />
        )}

        {permissions.canManageChannel && (
          <DeleteSection
            busy={busy}
            deleting={remove.isPending}
            onDelete={() => remove.mutate({ channelId })}
          />
        )}
      </div>
    </ChatDialog>
  );
}

/** The channel's icon and name, for people who can edit the channel. */
function DetailsSection({
  conversation,
  busy,
  update,
  onUpload,
  onRemoveImage,
}: {
  conversation: Conversation;
  busy: boolean;
  update: ReturnType<typeof api.channel.updateChannel.useMutation>;
  onUpload: (file: File) => Promise<unknown>;
  onRemoveImage: () => Promise<unknown>;
}) {
  const channelId = conversation.id;
  const [name, setName] = useState(conversation.name);

  return (
    <section aria-labelledby="channel-details" className="space-y-4">
      <h3 id="channel-details" className="text-sm font-semibold">
        Details
      </h3>
      <div className="flex items-center gap-3">
        <ChannelIcon
          name={conversation.name}
          imageUrl={conversation.imageUrl}
        />
        <ImageUploadButton
          kind="logo"
          label={conversation.imageUrl ? "Change icon" : "Upload icon"}
          hasImage={Boolean(conversation.imageUrl)}
          onUpload={onUpload}
          onRemove={onRemoveImage}
        />
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && name.trim() !== conversation.name)
            update.mutate({ channelId, name: name.trim() });
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="settings-name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="settings-name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <button
          type="submit"
          disabled={busy || !name.trim() || name.trim() === conversation.name}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </form>
      {update.isError && (
        <p role="alert" className="text-sm text-red-600">
          {update.error.message}
        </p>
      )}
    </section>
  );
}

/** Deletes the channel after asking for confirmation. */
function DeleteSection({
  busy,
  deleting,
  onDelete,
}: {
  busy: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <section
      aria-labelledby="channel-danger"
      className="rounded-lg border border-red-200 p-4"
    >
      <h3 id="channel-danger" className="text-sm font-semibold text-red-800">
        Delete channel
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        Deletes the channel and all of its messages and images. This can’t be
        undone.
      </p>
      {confirmDelete ? (
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Yes, delete it"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(false)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="mt-3 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete channel
        </button>
      )}
    </section>
  );
}

function MembersSection({
  channelId,
  currentUserId,
  isCompanyOwner,
  ownPermissions,
}: {
  channelId: string;
  currentUserId: string;
  isCompanyOwner: boolean;
  ownPermissions: Permissions;
}) {
  const utils = api.useUtils();
  const members = api.channel.listMembers.useQuery({ channelId });
  const onSuccess = () =>
    void utils.channel.listMembers.invalidate({ channelId });
  const setMember = api.channel.setMember.useMutation({ onSuccess });
  const removeMember = api.channel.removeMember.useMutation({ onSuccess });
  const error = setMember.error ?? removeMember.error;
  const busy = setMember.isPending || removeMember.isPending;
  const inChannel = (members.data ?? []).filter((row) => row.permissions);
  const others = (members.data ?? []).filter((row) => !row.permissions);

  return (
    <section aria-labelledby="channel-members" className="space-y-3">
      <h3 id="channel-members" className="text-sm font-semibold">
        Members
      </h3>
      {members.isPending && (
        <p role="status" className="text-sm text-gray-500">
          Loading members…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error.message}
        </p>
      )}
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {inChannel.map(({ user, role, permissions }) => {
          // Only the owner can change their own access; others can't lock themselves out.
          const locked = !isCompanyOwner && user.id === currentUserId;
          return (
            <li key={user.id} className="space-y-2 p-3">
              <div className="flex items-center gap-3">
                <PersonLabel user={user} role={role} bold>
                  {user.id === currentUserId && (
                    <span className="font-normal text-gray-500"> (you)</span>
                  )}
                </PersonLabel>
                {!locked && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      removeMember.mutate({ channelId, userId: user.id })
                    }
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-12">
                {PERMISSION_LABELS.map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-1.5 text-xs text-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={permissions?.[key] ?? false}
                      // You can only grant permissions you have yourself.
                      disabled={
                        busy ||
                        locked ||
                        (!isCompanyOwner && !ownPermissions[key])
                      }
                      onChange={(event) =>
                        permissions &&
                        setMember.mutate({
                          channelId,
                          userId: user.id,
                          permissions: {
                            ...permissions,
                            [key]: event.target.checked,
                          },
                        })
                      }
                      className="size-3.5"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <details className="rounded-md border border-gray-200">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Add people ({others.length})
          </summary>
          <ul className="divide-y divide-gray-100 border-t border-gray-200">
            {others.map(({ user, role }) => (
              <li key={user.id} className="flex items-center gap-3 p-3">
                <PersonLabel user={user} role={role} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setMember.mutate({
                      channelId,
                      userId: user.id,
                      permissions: SEND_ONLY,
                    })
                  }
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
