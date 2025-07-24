import { db } from "../../db";
import { versions, apps } from "../../db/schema";
import { eq, asc, and, sql } from "drizzle-orm";
import fs from "node:fs";
import git from "isomorphic-git";
import { getDyadAppPath } from "../../paths/paths";
import {
  getNeonClient,
  getNeonErrorMessage,
} from "../../neon_admin/neon_management_client";
import { EndpointType } from "@neondatabase/api-client";

import log from "electron-log";

const logger = log.scope("neon_branch_utils");

/**
 * Creates a Neon database branch from the current branch with a specific commit hash
 * and stores the branch ID in the versions table
 * @param appId - The app ID
 * @param commitHash - The commit hash to create the branch for (optional, uses current HEAD if not provided)
 * @param neonProjectId - The Neon project ID
 * @param neonBranchId - The current Neon branch ID to create the new branch from
 */
export async function storeBranchAtCommitHash({
  appId,
  commitHash,
  neonProjectId,
  neonBranchId,
}: {
  appId: number;
  commitHash?: string;
  neonProjectId: string;
  neonBranchId: string;
}): Promise<{ neonBranchId: string }> {
  try {
    logger.info(
      `Creating Neon branch for commit ${commitHash || "current HEAD"} - app ${appId}`,
    );

    // 1. Get the app to find the path
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error(`App with ID ${appId} not found`);
    }

    // 2. Get the commit hash (use provided one or current HEAD)
    let targetCommitHash = commitHash;
    if (!targetCommitHash) {
      const appPath = getDyadAppPath(app.path);
      targetCommitHash = await git.resolveRef({
        fs,
        dir: appPath,
        ref: "HEAD",
      });
    }

    logger.info(`Target commit hash: ${targetCommitHash}`);

    // 3. Create branch name with the commit hash
    const branchName = `version-${targetCommitHash}`;

    // 4. Check if a version with this commit hash already exists
    const existingVersion = await db.query.versions.findFirst({
      where: and(
        eq(versions.appId, appId),
        eq(versions.commitHash, targetCommitHash),
      ),
    });

    if (existingVersion && existingVersion.neonBranchId) {
      logger.info(
        `Version with commit hash ${targetCommitHash} already has Neon branch ${existingVersion.neonBranchId}. Reusing existing branch.`,
      );
      return { neonBranchId: existingVersion.neonBranchId };
    }

    const neonClient = await getNeonClient();

    // 5. If there are 6 or more versions with a branch, delete the oldest
    // branch which is a version that is NOT a favorite so that there's room
    // for another branch.
    // Why 6 branches? Because we have 3 permanent branches (production, development and preview)
    // Neon has 10 max branches per project for the free plan.
    // So 3 + 6 = 9 and we want to have 1 extra branch slot in case the user wants
    // to do manual DB intervention.
    const versionsWithBranches = await db.query.versions.findMany({
      where: and(
        eq(versions.appId, appId),
        // Only get versions that have a Neon branch ID
        sql`${versions.neonBranchId} IS NOT NULL`,
      ),
      orderBy: [asc(versions.createdAt)], // Oldest first
    });

    // If we have 6 or more versions with branches, delete the oldest non-favorite
    if (versionsWithBranches.length >= 6) {
      // Find the oldest non-favorite version with a branch
      const oldestNonFavorite = versionsWithBranches.find(
        (version) => !version.isFavorite && version.neonBranchId,
      );

      if (oldestNonFavorite && oldestNonFavorite.neonBranchId) {
        try {
          // Delete the Neon branch
          await neonClient.deleteProjectBranch(
            neonProjectId,
            oldestNonFavorite.neonBranchId,
          );

          // Remove the branch ID from the version record (but keep the version record)
          await db
            .update(versions)
            .set({
              neonBranchId: null,
              updatedAt: new Date(),
            })
            .where(eq(versions.id, oldestNonFavorite.id));

          logger.info(
            `Deleted oldest non-favorite Neon branch ${oldestNonFavorite.neonBranchId} for commit ${oldestNonFavorite.commitHash} to make room for new branch`,
          );
        } catch (branchDeleteError) {
          const errorMessage = `Failed to delete oldest Neon branch ${oldestNonFavorite.neonBranchId}: ${getNeonErrorMessage(branchDeleteError)}.`;
          logger.error(errorMessage);
          throw new Error(errorMessage);
        }
      } else {
        logger.warn(
          `Found ${versionsWithBranches.length} versions with branches, but all are favorites. Cannot delete any branches to make room.`,
        );
        throw new Error(
          "Found 6 or more versions with branches, but all are favorites. Cannot delete any branches to make room. Unmark one of the favorites and try again.",
        );
      }
    }

    // 6. Create the Neon database branch

    let newBranchId: string;
    try {
      const branchResponse = await neonClient.createProjectBranch(
        neonProjectId,
        {
          endpoints: [{ type: EndpointType.ReadWrite }],
          branch: {
            name: branchName,
            parent_id: neonBranchId,
          },
        },
      );

      if (!branchResponse.data.branch) {
        throw new Error("Failed to create branch: No branch data returned.");
      }

      newBranchId = branchResponse.data.branch.id;
      logger.info(
        `Successfully created Neon branch ${newBranchId} with name ${branchName}`,
      );
    } catch (neonError) {
      const errorMessage = getNeonErrorMessage(neonError);
      throw new Error(`Failed to create Neon branch: ${errorMessage}`);
    }

    // 7. Store the branch ID in the versions table
    if (existingVersion) {
      // Update existing version with the new branch ID
      await db
        .update(versions)
        .set({
          neonBranchId: newBranchId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(versions.appId, appId),
            eq(versions.commitHash, targetCommitHash),
          ),
        );
      logger.info(
        `Updated existing version record with Neon branch ID ${newBranchId}`,
      );
    } else {
      // Create new version record
      await db.insert(versions).values({
        appId,
        commitHash: targetCommitHash,
        neonBranchId: newBranchId,
        isFavorite: false,
      });
      logger.info(
        `Created new version record for commit ${targetCommitHash} with Neon branch ID ${newBranchId}`,
      );
    }

    logger.info(
      `Successfully stored branch for commit ${targetCommitHash} in app ${appId}`,
    );

    return { neonBranchId: newBranchId };
  } catch (error) {
    logger.error("Error in storeBranchAtCommitHash:", error);
    throw new Error("Could not store branch at commit hash: " + error);
  }
}

/**
 * Creates a Neon database branch from the current branch with the current git commit hash
 * and stores the branch ID in the versions table
 * @param appId - The app ID
 * @param neonProjectId - The Neon project ID
 * @param neonBranchId - The current Neon branch ID to create the new branch from
 */
export async function storeBranchAtCurrentVersion({
  appId,
  neonProjectId,
  neonBranchId,
}: {
  appId: number;
  neonProjectId: string;
  neonBranchId: string;
}): Promise<{ neonBranchId: string }> {
  return storeBranchAtCommitHash({
    appId,
    neonProjectId,
    neonBranchId,
  });
}
