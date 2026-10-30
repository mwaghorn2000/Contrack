import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { useState, type ReactNode } from "react";
import type { ChatMessage } from "~/lib/chat-message";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/trpc/react";

/** Answers a tRPC call by procedure path, e.g. "message.list". */
export type Handler = (path: string, input: unknown) => unknown;

/**
 * Wraps components in the real tRPC and React Query providers, with requests
 * answered by `handler` instead of the network. Returns the query client too.
 */
export function createTestProvider(handler: Handler) {
  const queryClient = new QueryClient({
    // Re-render on every change, since tests read results outside render.
    defaultOptions: {
      queries: { retry: false, notifyOnChangeProps: "all" },
      mutations: { retry: false },
    },
  });
  const link: TRPCLink<AppRouter> =
    () =>
    ({ op }) =>
      observable((observer) => {
        Promise.resolve()
          .then(() => handler(op.path, op.input))
          .then(
            (data) => {
              observer.next({ result: { type: "data", data } });
              observer.complete();
            },
            (cause: unknown) =>
              observer.error(TRPCClientError.from(cause as Error)),
          );
      });

  // Provides tRPC and React Query to the rendered tree.
  function Wrapper({ children }: { children: ReactNode }) {
    const [client] = useState(() => api.createClient({ links: [link] }));
    return (
      <QueryClientProvider client={queryClient}>
        <api.Provider client={client} queryClient={queryClient}>
          {children}
        </api.Provider>
      </QueryClientProvider>
    );
  }

  return { Wrapper, queryClient };
}

/** A NOT_FOUND error as the server sends it, for handlers to throw. */
export function notFoundError(message: string) {
  return new TRPCClientError<AppRouter>(message, {
    result: {
      error: {
        message,
        code: -32004,
        data: { code: "NOT_FOUND", httpStatus: 404, zodError: null },
      },
    },
  });
}

/** A text message for tests. */
export function textMessage(
  id: string,
  content = `Message ${id}`,
): ChatMessage {
  return {
    id,
    type: "TEXT",
    channelId: "channel-1",
    content,
    postedAt: new Date("2026-01-01T00:00:00Z"),
    editedAt: null,
    author: { id: "user-1", name: "Ada", image: null },
  };
}

/** A promise with its resolve function exposed, to finish a request on cue. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
