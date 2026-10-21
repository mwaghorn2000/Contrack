import { ConversationPage } from "~/app/_components/chat/chat-pages";

export default async function ChannelPage({
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
    <ConversationPage
      mode="channels"
      companyId={companyId}
      channelId={channelId}
    />
  );
}
