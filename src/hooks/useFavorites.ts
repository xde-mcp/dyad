import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";

export function useFavorites(appId: number | null) {
  const queryClient = useQueryClient();
  // Mutation for marking a favorite
  const markFavoriteMutation = useMutation({
    mutationFn: async (params: { commitHash: string }) => {
      if (!appId) throw new Error("App ID is required");
      const ipcClient = IpcClient.getInstance();
      return ipcClient.markFavorite({
        appId,
        commitHash: params.commitHash,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["versions", appId] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  // Mutation for unmarking a favorite
  const unmarkFavoriteMutation = useMutation({
    mutationFn: async (params: { commitHash: string }) => {
      if (!appId) throw new Error("App ID is required");
      const ipcClient = IpcClient.getInstance();
      return ipcClient.unmarkFavorite({
        appId,
        commitHash: params.commitHash,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["versions", appId] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  // Helper function to mark a favorite
  const markFavorite = async (commitHash: string) => {
    return markFavoriteMutation.mutateAsync({ commitHash });
  };

  // Helper function to unmark a favorite
  const unmarkFavorite = async (commitHash: string) => {
    return unmarkFavoriteMutation.mutateAsync({ commitHash });
  };

  return {
    markFavorite,
    unmarkFavorite,
    isMarkingFavorite: markFavoriteMutation.isPending,
    isUnmarkingFavorite: unmarkFavoriteMutation.isPending,
    isUpdatingFavorite:
      markFavoriteMutation.isPending || unmarkFavoriteMutation.isPending,
  };
}
