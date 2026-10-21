import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { authSession } from "~/server/auth";
import { withCompanyAccess } from "~/server/company-access";
import { api } from "~/trpc/server";
import ChatShell, { EmptyConversation } from "./chat-shell";
import ConversationView from "./conversation-view";
import type { ChatMode } from "./conversation-sidebar";

const routes: Record<ChatMode, string> = {
  channels: "/dashboard/chat",
  dms: "/dashboard/dms",
};

function listHref(mode: ChatMode, companyId: string) {
  return `${routes[mode]}?${new URLSearchParams({ companyId })}`;
}

async function loadCompany(companyId: string) {
  const [session, company] = await Promise.all([
    authSession(),
    withCompanyAccess(companyId, () => api.company.getCompany({ companyId })),
  ]);
  if (!session?.user) redirect("/login");
  const role = company.members[0]?.role;
  return {
    currentUserId: session.user.id,
    isCompanyOwner: role === "OWNER",
    canCreateChannels: role === "OWNER" || role === "ADMIN",
  };
}

/** /dashboard/chat and /dashboard/dms: open the most recent conversation. */
export async function ChatIndexPage({
  mode,
  companyId,
}: {
  mode: ChatMode;
  companyId: string | undefined;
}) {
  if (!companyId) return <p>Select a company to see its conversations.</p>;
  const viewer = await loadCompany(companyId);
  const conversations =
    mode === "channels"
      ? await api.channel.listChannels({ companyId })
      : await api.directMessage.list({ companyId });
  const first = conversations[0];
  if (first)
    redirect(
      `${routes[mode]}/${first.id}?${new URLSearchParams({ companyId })}`,
    );
  return (
    <ChatShell mode={mode} companyId={companyId} activeId={null} {...viewer}>
      <EmptyConversation>
        {mode === "channels"
          ? viewer.canCreateChannels
            ? "Create a channel to start talking with your team."
            : "You haven’t been added to any channels yet."
          : "Start a conversation with someone in your company."}
      </EmptyConversation>
    </ChatShell>
  );
}

/** /dashboard/chat/[channelId] and /dashboard/dms/[channelId]. */
export async function ConversationPage({
  mode,
  companyId,
  channelId,
}: {
  mode: ChatMode;
  companyId: string | undefined;
  channelId: string;
}) {
  if (!companyId) return <p>Select a company to see its conversations.</p>;
  const viewer = await loadCompany(companyId);
  const conversation = await api.channel
    .getChannel({ channelId })
    .catch((error: unknown) => {
      // A missing, inaccessible or malformed channel goes back to the list.
      if (
        error instanceof TRPCError &&
        (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")
      )
        return null;
      throw error;
    });
  const expectedKind = mode === "channels" ? "CHANNEL" : "DIRECT";
  if (
    conversation?.companyId !== companyId ||
    conversation.kind !== expectedKind
  )
    redirect(listHref(mode, companyId));
  return (
    <ChatShell
      mode={mode}
      companyId={companyId}
      activeId={channelId}
      {...viewer}
    >
      <ConversationView
        key={channelId}
        initialConversation={conversation}
        backHref={listHref(mode, companyId)}
        currentUserId={viewer.currentUserId}
        isCompanyOwner={viewer.isCompanyOwner}
      />
    </ChatShell>
  );
}
