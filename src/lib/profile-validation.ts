import { z } from "zod";

export const PROFILE_NAME_MAX_LENGTH = 100;
export const PROFILE_DESCRIPTION_MAX_LENGTH = 500;

export const profileNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .refine(
    (name) => [...name].length <= PROFILE_NAME_MAX_LENGTH,
    `Name must be ${PROFILE_NAME_MAX_LENGTH} characters or fewer.`,
  )
  .refine(
    (name) =>
      ![...name].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || (code >= 127 && code <= 159);
      }),
    "Name cannot contain control characters.",
  );

export const updateProfileSchema = z
  .object({
    name: profileNameSchema,
    description: z
      .string()
      .trim()
      .refine(
        (description) =>
          [...description].length <= PROFILE_DESCRIPTION_MAX_LENGTH,
        `Description must be ${PROFILE_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
      )
      .refine(
        (description) => !description.includes("\0"),
        "Description contains an unsupported character.",
      )
      .nullable()
      .transform((description) => (description === "" ? null : description)),
  })
  .strict();
