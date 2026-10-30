import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "./routers/auth";
import { companyRouter } from "./routers/company";
import { jobRouter } from "./routers/job";
import { jobTileRouter } from "./routers/job-tile";
import { invitationRouter } from "./routers/invitation";
import { profileRouter } from "./routers/profile";
import { securityRouter } from "./routers/security";
import { channelRouter } from "./routers/channel";
import { directMessageRouter } from "./routers/direct-message";
import { messageRouter } from "./routers/message";
import { realtimeRouter } from "./routers/realtime";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  company: companyRouter,
  job: jobRouter,
  jobTile: jobTileRouter,
  invitation: invitationRouter,
  profile: profileRouter,
  security: securityRouter,
  channel: channelRouter,
  directMessage: directMessageRouter,
  message: messageRouter,
  realtime: realtimeRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
