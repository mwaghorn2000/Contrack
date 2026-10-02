"use client";

import { SessionProvider, signOut, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useRef, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import AuthLayout from "./auth-layout";

export default function TwoFactorChallenge({
  session,
  destination,
}: {
  session: Session;
  destination: string;
}) {
  return (
    <SessionProvider session={session}>
      <ChallengeForm destination={destination} />
    </SessionProvider>
  );
}

function ChallengeForm({ destination }: { destination: string }) {
  const { update } = useSession();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [digits, setDigits] = useState<string[]>(Array<string>(6).fill(""));
  const digitInputs = useRef<Array<HTMLInputElement | null>>([]);
  const submitting = useRef(false);
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify(value: string) {
    if (submitting.current || (!recovery && !/^\d{6}$/.test(value))) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    let verified = false;
    try {
      const session = await update({ twoFactorCode: value });
      if (!session) {
        setError("Your sign-in expired. Please start again.");
      } else if (session.twoFactorRequired) {
        setError(
          "Code not accepted. Use a fresh code. After 10 attempts, wait 10 minutes before trying again.",
        );
      } else {
        verified = true;
        router.replace(destination);
        router.refresh();
      }
    } catch {
      setError("Could not verify your code. Please try again.");
    } finally {
      if (!verified) {
        submitting.current = false;
        setBusy(false);
        if (!recovery) {
          setDigits(Array<string>(6).fill(""));
          digitInputs.current[0]?.focus();
        }
      }
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void verify(recovery ? code : digits.join(""));
  }

  function enterDigits(index: number, value: string) {
    if (submitting.current) return;
    const entered = value.replace(/\D/g, "").slice(0, 6);
    if (value && !entered) return;
    const next = [...digits];
    // Full-code paste and autofill replace all six boxes from the beginning.
    const start = entered.length === 6 ? 0 : index;
    if (!entered) next[index] = "";
    else
      [...entered].forEach((digit, offset) => {
        if (start + offset < 6) next[start + offset] = digit;
      });
    setDigits(next);
    setError("");
    if (entered)
      digitInputs.current[Math.min(start + entered.length, 5)]?.focus();
    if (next.every((digit) => /^\d$/.test(digit))) void verify(next.join(""));
  }

  return (
    <AuthLayout
      title="Two-factor authentication"
      description={
        recovery
          ? "Enter one of your unused recovery codes."
          : "Enter the six-digit code from your authenticator app."
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {recovery ? (
          <div className="space-y-2">
            <label
              htmlFor="recovery-code"
              className="block text-sm font-medium text-gray-700"
            >
              Recovery code
            </label>
            <input
              id="recovery-code"
              autoComplete="one-time-code"
              required
              maxLength={64}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              readOnly={busy}
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
        ) : (
          <fieldset aria-describedby="authenticator-hint" className="space-y-3">
            <legend className="text-sm font-medium text-gray-700">
              Authenticator code
            </legend>
            <div className="grid grid-cols-6 gap-2">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(input) => {
                    digitInputs.current[index] = input;
                  }}
                  aria-label={`Digit ${index + 1} of 6`}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "two-factor-error" : undefined}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  pattern="[0-9]"
                  maxLength={6}
                  required
                  readOnly={busy}
                  autoFocus={index === 0}
                  value={digit}
                  onChange={(event) => enterDigits(index, event.target.value)}
                  onFocus={(event) => event.target.select()}
                  onPaste={(event) => {
                    event.preventDefault();
                    enterDigits(index, event.clipboardData.getData("text"));
                  }}
                  onKeyDown={(event) => {
                    if (submitting.current) return;
                    if (event.key === "Backspace") {
                      event.preventDefault();
                      const target =
                        digits[index] || index === 0 ? index : index - 1;
                      const next = [...digits];
                      next[target] = "";
                      setDigits(next);
                      setError("");
                      digitInputs.current[target]?.focus();
                    } else if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      digitInputs.current[
                        Math.max(
                          0,
                          Math.min(
                            5,
                            index + (event.key === "ArrowLeft" ? -1 : 1),
                          ),
                        )
                      ]?.focus();
                    }
                  }}
                  className="h-14 w-full min-w-0 rounded-lg border border-gray-300 text-center text-2xl font-semibold tabular-nums outline-none read-only:bg-gray-50 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 aria-invalid:border-red-500"
                />
              ))}
            </div>
            <p id="authenticator-hint" className="text-sm text-gray-500">
              Your code submits automatically after the sixth digit.
            </p>
          </fieldset>
        )}
        {error && (
          <p
            id="two-factor-error"
            role="alert"
            className="text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <button
          disabled={busy || (!recovery && digits.some((digit) => !digit))}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify and sign in"}
        </button>
        {busy && (
          <p role="status" className="sr-only">
            Verifying your code…
          </p>
        )}
      </form>
      <button
        disabled={busy}
        className="mt-4 block text-sm underline"
        onClick={() => {
          setRecovery(!recovery);
          setCode("");
          setDigits(Array<string>(6).fill(""));
          setError("");
        }}
      >
        {recovery ? "Use my authenticator app" : "Use a recovery code"}
      </button>
      <button
        disabled={busy}
        className="mt-4 block text-sm underline"
        onClick={() => void signOut({ callbackUrl: "/login" })}
      >
        Cancel and return to sign in
      </button>
    </AuthLayout>
  );
}
