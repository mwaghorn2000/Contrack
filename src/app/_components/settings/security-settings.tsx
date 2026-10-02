"use client";

import { useState, type SubmitEvent, type InputHTMLAttributes } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { api, type RouterOutputs } from "~/trpc/react";
import { passwordSchema } from "~/lib/password-validation";
import GoogleSignInButton from "../auth/google-sign-in-button";

const buttonClass =
  "rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50";
const panelClass = "space-y-4 rounded-xl border border-gray-200 bg-white p-6";
type SecurityStatus = RouterOutputs["security"]["get"];

function Field({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900"
      />
    </div>
  );
}

async function signInAgain() {
  await signOut({ callbackUrl: "/login?securityUpdated=1" });
}

export default function SecuritySettings() {
  const status = api.security.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  return (
    <section aria-labelledby="security-heading" className="space-y-6">
      <h2 id="security-heading" className="text-xl font-semibold text-gray-900">
        Account security
      </h2>
      {status.isPending && <p role="status">Loading security settings…</p>}
      {status.isError && (
        <p role="alert">
          Could not load security settings.{" "}
          <button className="underline" onClick={() => void status.refetch()}>
            Try again
          </button>
        </p>
      )}
      {status.data && (
        <>
          <PasswordSettings status={status.data} />
          <TwoFactorSettings status={status.data} />
        </>
      )}
    </section>
  );
}

function PasswordSettings({ status }: { status: SecurityStatus }) {
  const change = api.security.changePassword.useMutation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) return;
    setError("");
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your new password.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("The new passwords do not match.");
      return;
    }
    try {
      await change.mutateAsync({ currentPassword, newPassword, code });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setCode("");
      setSaved(true);
      await signInAgain();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not change your password.",
      );
    }
  }

  return (
    <div className={panelClass}>
      <h3 className="font-semibold text-gray-900">Change password</h3>
      {!status.hasPassword ? (
        <p className="text-sm text-gray-600">
          You sign in through a provider such as Google. Manage your password in
          that provider’s account settings.
        </p>
      ) : saved ? (
        <p role="status">
          Password changed.{" "}
          <button className="underline" onClick={() => void signInAgain()}>
            Sign in again
          </button>
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-gray-600">
            Use 12–128 characters with at least one number and one symbol.
            Changing your password signs you out on all devices.
          </p>
          <Field
            id="current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Field
            id="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Field
            id="confirm-new-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {status.enabled && (
            <Field
              id="password-security-code"
              label="Authenticator or recovery code"
              autoComplete="one-time-code"
              maxLength={128}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button disabled={change.isPending} className={buttonClass}>
            {change.isPending ? "Changing…" : "Change password"}
          </button>
        </form>
      )}
    </div>
  );
}

function TwoFactorSettings({ status }: { status: SecurityStatus }) {
  const begin = api.security.beginSetup.useMutation();
  const enable = api.security.enable.useMutation();
  const disable = api.security.disable.useMutation();
  const regenerate = api.security.regenerateRecoveryCodes.useMutation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(
    null,
  );
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [disabled, setDisabled] = useState(false);
  const busy =
    begin.isPending ||
    enable.isPending ||
    disable.isPending ||
    regenerate.isPending;

  async function act(action: "begin" | "enable" | "disable" | "regenerate") {
    if (busy) return;
    setError("");
    try {
      if (action === "begin") {
        const result = await begin.mutateAsync({ currentPassword });
        if (result.secret && result.qrCode)
          setSetup({ secret: result.secret, qrCode: result.qrCode });
      } else if (action === "enable" || action === "regenerate") {
        const result = await (
          action === "enable" ? enable : regenerate
        ).mutateAsync({ currentPassword, code });
        setRecoveryCodes(result.recoveryCodes ?? []);
        setRequiresSignIn(action === "enable");
        setAcknowledged(false);
        setSetup(null);
        setCurrentPassword("");
        setCode("");
      } else {
        await disable.mutateAsync({ currentPassword, code });
        setCurrentPassword("");
        setCode("");
        setDisabled(true);
        await signInAgain();
      }
      setCode("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not update two-factor authentication.",
      );
    }
  }

  function downloadCodes() {
    const blob = new Blob(
      [
        `Contrack recovery codes\nKeep these somewhere private. Each code works once.\n\n${recoveryCodes.join("\n")}\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "contrack-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={panelClass}>
      <h3 className="font-semibold text-gray-900">Two-factor authentication</h3>
      {recoveryCodes.length > 0 ? (
        <div className="space-y-4">
          <p role="status" className="text-sm text-green-700">
            {requiresSignIn
              ? "Two-factor authentication is enabled."
              : "New recovery codes created. Your previous codes no longer work."}
          </p>
          <p className="text-sm text-gray-600">
            Save these codes somewhere private before continuing. Each can be
            used once if you lose access to your authenticator. They will not be
            shown again.
          </p>
          <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 text-xs">
            {recoveryCodes.join("\n")}
          </pre>
          <button
            type="button"
            onClick={downloadCodes}
            className="text-sm underline"
          >
            Download recovery codes
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I have saved my recovery codes
          </label>
          <button
            className={buttonClass}
            disabled={!acknowledged}
            onClick={() => {
              if (requiresSignIn) void signInAgain();
              else {
                setRecoveryCodes([]);
                window.location.reload();
              }
            }}
          >
            {requiresSignIn ? "Continue to sign in" : "Done"}
          </button>
          {requiresSignIn && (
            <p className="text-sm text-gray-600">
              All devices have been signed out. Wait for a fresh authenticator
              code before signing in.
            </p>
          )}
        </div>
      ) : disabled ? (
        <p role="status">
          Two-factor authentication disabled.{" "}
          <button className="underline" onClick={() => void signInAgain()}>
            Sign in again
          </button>
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            {status.enabled
              ? `Enabled. ${status.recoveryCodesRemaining} recovery codes remaining. A code is required after password or Google sign-in.`
              : "Add an extra step at sign-in using Google Authenticator, Microsoft Authenticator, 1Password, or another authenticator app."}
          </p>
          {!status.enabled && status.needsRecentSignIn ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Sign in with Google again to confirm your identity before setup.
              </p>
              <GoogleSignInButton
                redirectTo="/dashboard/settings"
                reauthenticate
              />
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void act(
                  status.enabled ? "regenerate" : setup ? "enable" : "begin",
                );
              }}
            >
              {status.hasPassword && (
                <Field
                  id="two-factor-password"
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              )}
              {setup && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Scan this QR code in your authenticator app, then enter its
                    six-digit code to enable two-factor authentication. Setup
                    expires in 10 minutes.
                  </p>
                  <Image
                    src={setup.qrCode}
                    alt="Scan to add your Contrack account to your authenticator"
                    width={220}
                    height={220}
                    unoptimized
                  />
                  <p className="text-sm text-gray-600">
                    Or enter this setup key manually:
                  </p>
                  <code className="block rounded-md bg-gray-50 p-3 text-sm break-all select-all">
                    {setup.secret}
                  </code>
                </div>
              )}
              {(setup !== null || status.enabled) && (
                <Field
                  id="settings-security-code"
                  label={
                    setup
                      ? "Authenticator code"
                      : "Authenticator or recovery code"
                  }
                  autoComplete="one-time-code"
                  inputMode={setup ? "numeric" : "text"}
                  maxLength={setup ? 6 : 128}
                  pattern={setup ? "[0-9]{6}" : undefined}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <button disabled={busy} className={buttonClass}>
                  {busy
                    ? "Please wait…"
                    : status.enabled
                      ? "Replace recovery codes"
                      : setup
                        ? "Enable two-factor authentication"
                        : "Set up authenticator"}
                </button>
                {setup && (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-sm underline"
                    onClick={() => {
                      setSetup(null);
                      setCode("");
                      setCurrentPassword("");
                      setError("");
                    }}
                  >
                    Cancel setup
                  </button>
                )}
                {status.enabled && (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-sm text-red-700 underline"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Disable two-factor authentication? You will be signed out on all devices.",
                        )
                      )
                        void act("disable");
                    }}
                  >
                    Disable two-factor authentication
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
