import { handlers } from "~/server/auth";
import  GoogleProvider  from "next-auth/providers/google";
import { env } from "~/env";

export const { GET, POST } = handlers;
