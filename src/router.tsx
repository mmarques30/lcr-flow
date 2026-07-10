import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 20,
    defaultPreloadStaleTime: 2 * 60_000,
    defaultPendingMs: 100,
    defaultPendingMinMs: 200,
    defaultPendingComponent: PendingComponent,
  });

  return router;
};

function PendingComponent() {
  return (
    <div className="mx-auto max-w-7xl px-6 pt-8 lg:px-10">
      <div className="mb-6 h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-card shadow-soft" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-3xl bg-card shadow-soft" />
    </div>
  );
}
