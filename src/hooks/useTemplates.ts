import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { getLocalTemplates } from "@/ipc/utils/template_utils";
import type { Template } from "@/shared/templates";

export function useTemplates() {
  const query = useQuery({
    queryKey: ["templates"],
    queryFn: async (): Promise<Template[]> => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getTemplates();
    },
    initialData: getLocalTemplates(),
    meta: {
      showErrorToast: true,
    },
  });

  return {
    templates: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
