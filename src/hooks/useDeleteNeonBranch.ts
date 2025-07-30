import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { DeleteNeonBranchParams } from "@/ipc/ipc_types";
import type { DeleteNeonBranchResult } from "@/ipc/utils/neon_branch_utils";
import { showError } from "@/lib/toast";
import { toast } from "sonner";

export function useDeleteNeonBranch() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    DeleteNeonBranchResult,
    Error,
    DeleteNeonBranchParams
  >({
    mutationFn: async (params: DeleteNeonBranchParams) => {
      if (!params.appId) {
        throw new Error("App ID is required");
      }
      if (!params.branchId) {
        throw new Error("Branch ID is required");
      }
      if (!params.branchName) {
        throw new Error("Branch name is required");
      }

      const ipcClient = IpcClient.getInstance();
      return ipcClient.deleteNeonBranch(params);
    },
    onSuccess: (result, variables) => {
      // Show success or warning message
      if (result.successMessage) {
        toast.success(result.successMessage);
      } else if (result.warningMessage) {
        toast.warning(result.warningMessage);
      }

      // Invalidate Neon project query to refresh the branches list
      queryClient.invalidateQueries({
        queryKey: ["neon-project", variables.appId],
      });
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteBranch = async (
    params: DeleteNeonBranchParams,
  ): Promise<DeleteNeonBranchResult> => {
    return mutation.mutateAsync(params);
  };

  return {
    deleteBranch,
    isDeleting: mutation.isPending,
    error: mutation.error,
  };
}
