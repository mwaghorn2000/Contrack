"use client";

import Link from "next/link";
import React, { useRef, useState, type SubmitEvent } from "react";

import AuthLayout from "../_components/auth/auth-layout";
import GoogleSignInButton from "../_components/auth/google-sign-in-button";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export default function SignupPage() {
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [fullNameError, setFullNameError] = useState("");
  const [emailError, setEmailError] = useState("");

  const router = useRouter();
  const signup = api.auth.signup.useMutation();
  const sendCode = api.auth.verificationEmail.useMutation();

  const [submitError, setSubmitError] = useState("");

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validatePassword || !validateFullName || !validateEmail) {
      return;
    }

    const email = emailRef.current!.value.trim();

    try {
      await signup.mutateAsync({
        fullName: fullNameRef.current!.value.trim(),
        email,
        password: passwordRef.current!.value,
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Couldnt create your account.",
      );
      return;
    }

    try {
      await sendCode.mutateAsync({ email });
    } catch {
      router.push(
        `/verify-email?email=${encodeURIComponent(email)}&sendFailed=1`,
      );
      return;
    }

    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  function validatePassword(showError = true): boolean {
    const input = passwordRef.current;
    if (!input) return false;

    // Count Unicode code points without trimming or changing the password.
    const length = [...input.value].length;
    const hasNumber = /\p{Nd}/u.test(input.value);
    const hasSymbol = /[\p{P}\p{S}]/u.test(input.value);
    let message = "";

    if (length === 0) {
      message = "Enter a password.";
    } else if (length < MIN_PASSWORD_LENGTH) {
      message = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (length > MAX_PASSWORD_LENGTH) {
      message = `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
    } else if (!hasNumber && !hasSymbol) {
      message = "Include at least one number and one symbol.";
    } else if (!hasNumber) {
      message = "Include at least one number.";
    } else if (!hasSymbol) {
      message = "Include at least one symbol, such as !, @, or #.";
    }

    input.setCustomValidity(message);
    if (showError) setPasswordError(message);

    return message === "";
  }

  function validatePasswords() {
    const confirmation = confirmPasswordRef.current;
    if (!confirmation) return;

    const message =
      confirmation.value && confirmation.value !== passwordRef.current?.value
        ? "Passwords do not match."
        : "";

    confirmation.setCustomValidity(message);
    setConfirmPasswordError(message);
  }

  function validateFullName(showError = true): boolean {
    const input = fullNameRef.current;
    if (!input) return false;

    const name = input.value.trim();

    const hasControlCharacters = [...input.value].some((character) => {
      const code = character.charCodeAt(0);

      return code <= 31 || (code >= 127 && code <= 159);
    });

    let message = "";

    if (name.length === 0) {
      message = "Enter your full name.";
    } else if ([...name].length > 100) {
      message = "Name must be 100 characters or fewer.";
    } else if (hasControlCharacters) {
      message = "Name cannot contain tabs, line breaks, or control characters.";
    }

    input.setCustomValidity(message);
    if (showError) setFullNameError(message);

    return message === "";
  }

  function validateEmail(showError = true): boolean {
    const input = emailRef.current;
    if (!input) return false;

    input.value = input.value.trim();

    let message = "";

    if (input.value.length === 0) {
      message = "Enter your email address.";
    } else if (input.value.length > 254) {
      message = "Email must be 254 characters or fewer.";
    } else if (input.validity.typeMismatch) {
      message = "Enter a valid email address.";
    }

    input.setCustomValidity(message);
    if (showError) setEmailError(message);
    return message === "";
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Get started with Contrack"
    >
      <form method="post" className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label
            htmlFor="full-name"
            className="block text-sm font-medium text-gray-700"
          >
            Full Name
          </label>

          <input
            type="text"
            ref={fullNameRef}
            onChange={() => validateFullName(Boolean(fullNameError))}
            onBlur={() => validateFullName()}
            onInvalid={() => validateFullName()}
            id="full-name"
            name="name"
            autoComplete="name"
            placeholder="Your full name"
            required
            aria-invalid={Boolean(fullNameError)}
            aria-describedby={fullNameError ? "full-name-error" : undefined}
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-100"
          />

          {fullNameError && (
            <p
              id="full-name-error"
              role="alert"
              className="text-sm text-red-600"
            >
              {fullNameError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700"
          >
            Email
          </label>

          <input
            type="email"
            ref={emailRef}
            onChange={() => validateEmail(Boolean(emailError))}
            onBlur={() => validateEmail()}
            onInvalid={() => validateEmail()}
            id="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "email-error" : undefined}
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-100"
          />

          {emailError && (
            <p id="email-error" role="alert" className="text-sm text-red-600">
              {emailError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700"
          >
            Password
          </label>

          <input
            type="password"
            id="password"
            name="password"
            autoComplete="new-password"
            ref={passwordRef}
            onChange={() => {
              validatePassword(Boolean(passwordError));
              validatePasswords();
            }}
            onBlur={() => validatePassword()}
            onInvalid={() => validatePassword()}
            required
            aria-invalid={Boolean(passwordError)}
            aria-describedby={
              passwordError ? "password-help password-error" : "password-help"
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-100"
          />

          <p id="password-help" className="text-xs text-gray-500">
            Use {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} characters,
            including at least one number and one symbol (such as !, @, or #).
            Spaces are welcome.
          </p>

          {passwordError && (
            <p
              id="password-error"
              role="alert"
              className="text-sm text-red-600"
            >
              {passwordError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-gray-700"
          >
            Confirm password
          </label>

          <input
            type="password"
            id="confirm-password"
            name="confirmPassword"
            autoComplete="new-password"
            ref={confirmPasswordRef}
            onChange={validatePasswords}
            required
            aria-invalid={Boolean(confirmPasswordError)}
            aria-describedby={
              confirmPasswordError ? "confirm-password-error" : undefined
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-100"
          />

          {confirmPasswordError && (
            <p
              id="confirm-password-error"
              role="alert"
              className="text-sm text-red-600"
            >
              {confirmPasswordError}
            </p>
          )}
        </div>
        {submitError && <p role="alert">{submitError}</p>}
        <button
          type="submit"
          disabled={signup.isPending || sendCode.isPending}
          className="w-full rounded-md bg-black px-4 py-2.5 font-medium text-white transition hover:bg-gray-800 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-none active:scale-[0.99]"
        >
          {signup.isPending || sendCode.isPending
            ? "Please wait..."
            : "Create account"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-sm font-medium text-gray-400">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <GoogleSignInButton />

      <div className="mt-6 flex items-center justify-center gap-1 text-sm">
        <span className="text-gray-500">Already have an account?</span>
        <Link
          href="/login"
          className="rounded-sm font-medium text-gray-900 underline-offset-4 hover:underline focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 focus:outline-none"
        >
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
