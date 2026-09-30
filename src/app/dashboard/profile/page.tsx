import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import MemberAvatar from "~/app/_components/_dashboard-components/_home-components/member-avatar";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">My profile</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your personal details in Contrack.
        </p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <MemberAvatar
            name={user.name ?? user.email ?? "Account"}
            image={user.image ?? null}
          />
          <p className="font-medium break-words text-gray-900">
            {user.name ?? "Your account"}
          </p>
        </div>
        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-gray-500">Name</dt>
            <dd className="mt-1 break-words text-gray-900">
              {user.name ?? "Not provided"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Email</dt>
            <dd className="mt-1 break-words text-gray-900">
              {user.email ?? "Not provided"}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
