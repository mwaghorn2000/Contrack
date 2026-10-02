import { z } from "zod";

export const passwordSchema = z
  .string()
  .regex(/\p{Nd}/u, "Include at least one number.")
  .regex(/[\p{P}\p{S}]/u, "Include at least one symbol.")
  .refine(
    (password) => [...password].length >= 12 && [...password].length <= 128,
    "Password must be between 12 and 128 characters.",
  );

export const currentPasswordSchema = z.string().max(512).default("");
