import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { CatModeRoot } from "./catMode";
import { createRoutes } from "./routes";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});
const router = createBrowserRouter(createRoutes(queryClient));

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CatModeRoot />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
