import { ChatIndexPage } from "~/app/_components/chat/chat-pages";

export default async function CompanyChatPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  return <ChatIndexPage mode="channels" companyId={companyId} />;
}
