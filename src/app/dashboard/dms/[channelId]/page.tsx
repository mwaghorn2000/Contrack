import { ConversationPage } from "~/app/_components/chat/chat-pages";

export default async function DirectMessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ companyId?: string }>;
}) {
  const [{ channelId }, { companyId }] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <ConversationPage mode="dms" companyId={companyId} channelId={channelId} />
  );
}
