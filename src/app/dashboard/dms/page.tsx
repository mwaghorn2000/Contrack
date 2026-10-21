import { ChatIndexPage } from "~/app/_components/chat/chat-pages";

export default async function DirectMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  return <ChatIndexPage mode="dms" companyId={companyId} />;
}
