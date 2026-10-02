import SecuritySettings from "~/app/_components/settings/security-settings";

export default function AccountSettingsPage() {
  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Account settings
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your password and two-factor authentication.
        </p>
      </div>
      <SecuritySettings />
    </section>
  );
}
