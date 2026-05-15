import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminLoginRequest, AdminUser } from "@bun-dev-intel/admin-contracts";
import { adminApiClient, type AdminApiClient } from "./api-client";

export const adminSessionQueryKey = ["admin", "session"] as const;

const AdminApiContext = createContext<AdminApiClient | null>(null);

export function AdminApiProvider(props: { readonly client?: AdminApiClient; readonly children: ReactNode }) {
  return <AdminApiContext.Provider value={props.client ?? adminApiClient}>{props.children}</AdminApiContext.Provider>;
}

export function useAdminApi(): AdminApiClient {
  const client = useContext(AdminApiContext);

  if (client === null) {
    throw new Error("Admin API client is not available.");
  }

  return client;
}

export function useAdminSession() {
  const api = useAdminApi();

  return useQuery({
    queryKey: adminSessionQueryKey,
    queryFn: () => api.getMe(),
    retry: false,
    staleTime: 30_000
  });
}

export function useLoginMutation() {
  const api = useAdminApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AdminLoginRequest) => api.login(input),
    onSuccess: (user) => {
      queryClient.setQueryData<AdminUser | null>(adminSessionQueryKey, user);
    }
  });
}

export function useLogoutMutation() {
  const api = useAdminApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => clearAdminSessionCache(queryClient)
  });
}

export function clearAdminSessionCache(queryClient: QueryClient): void {
  queryClient.setQueryData<AdminUser | null>(adminSessionQueryKey, null);
  void queryClient.invalidateQueries({ queryKey: adminSessionQueryKey });
}
