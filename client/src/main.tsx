import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "./lib/trpc";
import { AuthProvider } from "./hooks/useAuth";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { initErrorReporter, reportApiError } from "@/lib/errorReporter";
import "./index.css";

// 글로벌 에러 수집 초기화
initErrorReporter();

function Root() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
      mutations: {
        onError: (error: any) => {
          reportApiError(error?.message || "mutation error", { path: error?.data?.path });
        },
      },
    },
  }));

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          headers() {
            const token = localStorage.getItem("token");
            return token ? { cookie: `session=${token}` } : {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider defaultTheme="dark" switchable>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
            <Toaster position="top-right" richColors />
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Root /></StrictMode>
);
