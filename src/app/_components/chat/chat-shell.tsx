import type { ReactNode } from "react";
import ConversationSidebar, { type ChatMode } from "./conversation-sidebar";

/**
 * Discord-style layout: the conversation list on the left and the open
 * conversation filling the rest. On small screens only one is shown at a time.
 */
export default function ChatShell({
  mode,
  companyId,
  activeId,
  canCreateChannels,
  currentUserId,
  children,
}: {
  mode: ChatMode;
  companyId: string;
  activeId: string | null;
  canCreateChannels: boolean;
  currentUserId: string;
  children: ReactNode;
}) {
  return (
    // Fill the dashboard's main area edge to edge, cancelling its padding.
    <div className="-m-6 flex h-[calc(100dvh-4rem)] min-h-0 overflow-hidden md:h-[calc(100%+3rem)]">
      <div
        className={`${activeId ? "hidden md:flex" : "flex"} min-h-0 w-full md:w-auto`}
      >
        <ConversationSidebar
          mode={mode}
          companyId={companyId}
          activeId={activeId}
          canCreateChannels={canCreateChannels}
          currentUserId={currentUserId}
        />
      </div>
      <div
        className={`${activeId ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1`}
      >
        {children}
      </div>
    </div>
  );
}

export function EmptyConversation({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-white p-6 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}
