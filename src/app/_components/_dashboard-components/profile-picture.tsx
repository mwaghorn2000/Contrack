import Image from "next/image";
import { auth } from "~/server/auth";

export default async function ProfilePicture() {
  const session = await auth();
  const initials = session?.user.name?.slice(0, 2).toUpperCase();
  const displayName = session?.user?.name ?? session?.user?.email ?? "Account";
  return (
    <div>
      {session?.user.image ? (
        <Image
          src={session.user.image}
          alt={`${displayName}'s profile`}
          width={36}
          height={36}
          referrerPolicy="no-referrer"
          className="size-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
          {initials}
        </span>
      )}
    </div>
  );
}
