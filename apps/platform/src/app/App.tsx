import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { StylePage } from "@/app/StylePage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/style" element={<StylePage />} />
          <Route path="*" element={<Navigate to="/style" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
