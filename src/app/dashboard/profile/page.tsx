import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { api } from "~/trpc/server";
import ProfileForm from "~/app/_components/profile/profile-form";

export default async function ProfilePage() {
  const profile = await api.profile.get().catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "UNAUTHORIZED")
      redirect("/login");
    throw error;
  });

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">My profile</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your personal details in Contrack.
        </p>
      </div>
      <ProfileForm initialProfile={profile} />
    </section>
  );
}
