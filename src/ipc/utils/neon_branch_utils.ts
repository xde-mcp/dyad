import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { apps, versions } from "../../db/schema";
import {
  getNeonClient,
  getNeonErrorMessage,
} from "../../neon_admin/neon_management_client";
import { retryOnLocked } from "./retryOnLocked";
import {} from "./app_env_var_utils";

export const logger = log.scope("neon_branch_utils");

export interface DeleteNeonBranchResult {
  successMessage?: string;
  warningMessage?: string;
}

/**
 * Deletes a Neon branch and clears all version records that reference it
 */
export async function deleteNeonBranch(
  appId: number,
  projectId: string,
  branchId: string,
  branchName: string,
): Promise<DeleteNeonBranchResult> {
  logger.info(
    `Deleting Neon branch ${branchId} (${branchName}) for app ${appId}`,
  );

  let warningMessage: string | undefined;

  try {
    // First, try to delete the branch from Neon
    const neonClient = await getNeonClient();

    // Restore preview branch to the development branch
    // This ensures the app's database connection remains functional if it was using the branch we're about to delete
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error(`App with ID ${appId} not found`);
    }

    // try {
    //   await retryOnLocked(
    //     () =>
    //       neonClient.restoreProjectBranch(
    //         app.neonProjectId!,
    //         app.neonPreviewBranchId!,
    //         {
    //           source_branch_id: app.neonDevelopmentBranchId!,
    //         },
    //       ),
    //     `Restore preview branch ${app.neonPreviewBranchId} for app ${appId}`,
    //   );
    // } catch (error) {
    //   const errorMessage = getNeonErrorMessage(error);
    //   logger.error(
    //     "Error in restoring branch for preview before delete:",
    //     errorMessage,
    //   );
    //   throw new Error(errorMessage);
    // }

    try {
      await retryOnLocked(
        () => neonClient.deleteProjectBranch(projectId, branchId),
        `Delete branch ${branchId} (${branchName}) for app ${appId}`,
        { retryBranchWithChildError: true },
      );
      logger.info(`Successfully deleted Neon branch ${branchId}`);
    } catch (error) {
      const errorMessage = getNeonErrorMessage(error);
      logger.error("Error deleting Neon branch:", errorMessage);
      warningMessage = `Failed to delete branch from Neon. You may need to delete branch "${branchName}" manually in Neon Console.`;
      // Don't throw here - continue to clean up local data
    }

    // Clean up all version records that reference this branch
    const deleteResult = await db
      .update(versions)
      .set({
        neonDbTimestamp: null,
        neonBranchId: null,
      })
      .where(eq(versions.neonBranchId, branchId));

    logger.info(
      `Cleared ${deleteResult.changes} version records for branch ${branchId}`,
    );

    if (warningMessage) {
      return { warningMessage };
    } else {
      return {
        successMessage: `Successfully deleted branch "${branchName}" and cleared ${deleteResult.changes} version records.`,
      };
    }
  } catch (error) {
    const errorMessage = getNeonErrorMessage(error);
    logger.error(`Failed to delete Neon branch ${branchId}:`, errorMessage);
    throw new Error(`Failed to delete branch "${branchName}": ${errorMessage}`);
  }
}
