import { db } from "../../db";
import { apps, messages, versions } from "../../db/schema";
import { desc, eq, and, gt } from "drizzle-orm";
import type { Version, BranchResult } from "../ipc_types";
import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath } from "../../paths/paths";
import git, { type ReadCommitResult } from "isomorphic-git";
import { withLock } from "../utils/lock_utils";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { gitCheckout, gitCommit, gitStageToRevert } from "../utils/git_utils";
import { storeBranchAtCommitHash } from "../utils/neon_store_branch_utils";
import {
  getNeonClient,
  getNeonErrorMessage,
} from "../../neon_admin/neon_management_client";
import { updatePostgresUrlEnvVar } from "../utils/app_env_var_utils";

const logger = log.scope("version_handlers");

const handle = createLoggedHandler(logger);

/**
 * Restores the database to match a target commit hash by either using a favorite branch
 * or creating a restore from a snapshot timestamp
 */
async function restoreBranch({
  appId,
  targetCommitHash,
  neonProjectId,
  branchIdToUpdate,
  preserve,
}: {
  appId: number;
  targetCommitHash: string;
  neonProjectId: string;
  branchIdToUpdate: string;
  preserve?: {
    branchName: string;
    commitHash: string;
  };
}): Promise<void> {
  try {
    const targetVersion = await db.query.versions.findFirst({
      where: and(
        eq(versions.appId, appId),
        eq(versions.commitHash, targetCommitHash),
      ),
    });

    if (!targetVersion) {
      throw new Error(`Version ${targetCommitHash} not found`);
    }

    if (!targetVersion.neonBranchId) {
      throw new Error(
        `Version ${targetCommitHash} does not have a Neon branch`,
      );
    }

    // Use the existing favorite branch to restore from
    logger.info(
      `Found favorite branch ${targetVersion.neonBranchId} for commit ${targetCommitHash}`,
    );

    const neonClient = await getNeonClient();

    try {
      const branchResponse = await neonClient.restoreProjectBranch(
        neonProjectId,
        branchIdToUpdate,
        {
          source_branch_id: targetVersion.neonBranchId,
          preserve_under_name: preserve?.branchName,
        },
      );

      if (!branchResponse.data.branch) {
        throw new Error(
          "Failed to restore from branch: No branch data returned.",
        );
      }

      if (preserve) {
        const projectBranches = await neonClient.listProjectBranches({
          projectId: neonProjectId,
          search: preserve?.branchName,
        });
        const branches = projectBranches.data.branches;
        if (branches.length === 0) {
          throw new Error("Could not find preserved branch");
        }
        if (branches.length > 1) {
          throw new Error("Found multiple preserved branches");
        }
        const branch = branches[0];
        if (branch.name !== preserve?.branchName) {
          throw new Error("Preserved branch name does not match");
        }
        // delete old branch if possible
        try {
          const preservedVersion = await db.query.versions.findFirst({
            where: and(
              eq(versions.appId, appId),
              eq(versions.commitHash, preserve?.commitHash),
            ),
          });
          if (!preservedVersion) {
            throw new Error("Preserved version not found");
          }
          if (preservedVersion.neonBranchId) {
            logger.info(
              `Deleting old branch ${preservedVersion.neonBranchId} for commit ${preserve.commitHash}`,
            );
            await neonClient.deleteProjectBranch(
              neonProjectId,
              preservedVersion!.neonBranchId,
            );
            logger.info(
              `Successfully deleted old branch ${preservedVersion.neonBranchId} for commit ${preserve.commitHash}`,
            );
          } else {
            logger.info(
              `Preserved version ${preserve.commitHash} does not have a Neon branch`,
            );
          }
        } catch (error) {
          logger.warn(
            `Failed to delete old branch ${branch.id} for commit ${targetCommitHash}: ${getNeonErrorMessage(error)}`,
          );
        }
        await db
          .update(versions)
          .set({
            neonBranchId: branch.id,
          })
          .where(
            and(
              eq(versions.appId, appId),
              eq(versions.commitHash, targetCommitHash),
            ),
          );
        logger.info(
          `Successfully updated version ${preserve.commitHash} with preserved branch ${branch.id}`,
        );
      }

      logger.info(
        `Successfully restored current branch from branch ${targetVersion.neonBranchId} for commit ${targetCommitHash}`,
      );
    } catch (neonError) {
      const errorMessage = getNeonErrorMessage(neonError);
      throw new Error(`Failed to restore Neon branch: ${errorMessage}`);
    }
  } catch (error) {
    logger.error("Error in restoreToFavoriteOrSnapshot:", error);
    throw error;
  }
}

export function registerVersionHandlers() {
  handle("list-versions", async (_, { appId }: { appId: number }) => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      // The app might have just been deleted, so we return an empty array.
      return [];
    }

    const appPath = getDyadAppPath(app.path);

    // Just return an empty array if the app is not a git repo.
    if (!fs.existsSync(path.join(appPath, ".git"))) {
      return [];
    }

    const commits = await git.log({
      fs,
      dir: appPath,
      // KEEP UP TO DATE WITH ChatHeader.tsx
      depth: 10_000, // Limit to last 10_000 commits for performance
    });

    // Get all snapshots for this app to match with commits
    const appSnapshots = await db.query.versions.findMany({
      where: eq(versions.appId, appId),
    });

    // Create a map of commitHash -> snapshot info for quick lookup
    const snapshotMap = new Map<
      string,
      { neonBranchId: string | null; createdAt: Date; isFavorite: boolean }
    >();
    for (const snapshot of appSnapshots) {
      snapshotMap.set(snapshot.commitHash, {
        neonBranchId: snapshot.neonBranchId,
        createdAt: snapshot.createdAt,
        isFavorite: snapshot.isFavorite,
      });
    }

    return commits.map((commit: ReadCommitResult) => {
      const snapshotInfo = snapshotMap.get(commit.oid);
      console.log("snapshotInfo", snapshotInfo);
      return {
        oid: commit.oid,
        message: commit.commit.message,
        timestamp: commit.commit.author.timestamp,
        hasDbSnapshot: snapshotInfo?.neonBranchId != null,
        isFavorite: snapshotInfo?.isFavorite || false,
      };
    }) satisfies Version[];
  });

  handle(
    "get-current-branch",
    async (_, { appId }: { appId: number }): Promise<BranchResult> => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const appPath = getDyadAppPath(app.path);

      // Return appropriate result if the app is not a git repo
      if (!fs.existsSync(path.join(appPath, ".git"))) {
        throw new Error("Not a git repository");
      }

      try {
        const currentBranch = await git.currentBranch({
          fs,
          dir: appPath,
          fullname: false,
        });

        return {
          branch: currentBranch || "<no-branch>",
        };
      } catch (error: any) {
        logger.error(`Error getting current branch for app ${appId}:`, error);
        throw new Error(`Failed to get current branch: ${error.message}`);
      }
    },
  );

  handle(
    "revert-version",
    async (
      _,
      {
        appId,
        previousVersionId,
      }: { appId: number; previousVersionId: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        const appPath = getDyadAppPath(app.path);
        // Get the current commit hash before reverting
        const currentCommitHash = await git.resolveRef({
          fs,
          dir: appPath,
          ref: "main",
        });
        // Only create Neon branch if the app has Neon integration
        if (app.neonProjectId && app.neonDevelopmentBranchId) {
          try {
            await storeBranchAtCommitHash({
              appId,
              commitHash: currentCommitHash,
              neonProjectId: app.neonProjectId,
              neonBranchId: app.neonDevelopmentBranchId,
            });
            logger.info(
              `Created Neon branch for current commit ${currentCommitHash} before reverting`,
            );
          } catch (error) {
            logger.error("Error creating Neon branch at current hash:", error);
            throw error;
          }
        }

        await gitCheckout({
          path: appPath,
          ref: "main",
        });

        await gitStageToRevert({
          path: appPath,
          targetOid: previousVersionId,
        });

        await gitCommit({
          path: appPath,
          message: `Reverted all changes back to version ${previousVersionId}`,
        });

        // Find the chat and message associated with the commit hash
        const messageWithCommit = await db.query.messages.findFirst({
          where: eq(messages.commitHash, previousVersionId),
          with: {
            chat: true,
          },
        });

        // If we found a message with this commit hash, delete all subsequent messages (but keep this message)
        if (messageWithCommit) {
          const chatId = messageWithCommit.chatId;

          // Find all messages in this chat with IDs > the one with our commit hash
          const messagesToDelete = await db.query.messages.findMany({
            where: and(
              eq(messages.chatId, chatId),
              gt(messages.id, messageWithCommit.id),
            ),
            orderBy: desc(messages.id),
          });

          logger.log(
            `Deleting ${messagesToDelete.length} messages after commit ${previousVersionId} from chat ${chatId}`,
          );

          // Delete the messages
          if (messagesToDelete.length > 0) {
            await db
              .delete(messages)
              .where(
                and(
                  eq(messages.chatId, chatId),
                  gt(messages.id, messageWithCommit.id),
                ),
              );
          }
        }

        if (app.neonProjectId && app.neonDevelopmentBranchId) {
          try {
            await restoreBranch({
              appId,
              targetCommitHash: previousVersionId,
              neonProjectId: app.neonProjectId,
              branchIdToUpdate: app.neonDevelopmentBranchId,
              preserve: {
                branchName: `restore_before-${currentCommitHash}-timestamp-${new Date().toISOString()}`,
                commitHash: previousVersionId,
              },
            });
          } catch (error) {
            throw new Error(
              "Error restoring database for target hash: " + error,
            );
          }

          // MAY BE REMOVE THIS
          await switchPostgresToDevelopmentBranch({
            neonProjectId: app.neonProjectId,
            neonDevelopmentBranchId: app.neonDevelopmentBranchId,
            appPath: app.path,
          });
        }
      });
    },
  );

  handle(
    "checkout-version",
    async (
      _,
      { appId, versionId }: { appId: number; versionId: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        if (
          app.neonProjectId &&
          app.neonDevelopmentBranchId &&
          app.neonPreviewBranchId
        ) {
          if (versionId === "main") {
            logger.info(
              `Switching Postgres to development branch for app ${appId}`,
            );
            await switchPostgresToDevelopmentBranch({
              neonProjectId: app.neonProjectId,
              neonDevelopmentBranchId: app.neonDevelopmentBranchId,
              appPath: app.path,
            });
          } else {
            logger.info(
              `Switching Postgres to preview branch for app ${appId}`,
            );
            // SWITCH the env var for POSTGRES_URL to the preview branch
            const neonClient = await getNeonClient();
            const connectionUri = await neonClient.getConnectionUri({
              projectId: app.neonProjectId,
              branch_id: app.neonPreviewBranchId,
              // This is the default database name for Neon
              database_name: "neondb",
              // This is the default role name for Neon
              role_name: "neondb_owner",
            });

            await updatePostgresUrlEnvVar({
              appPath: app.path,
              connectionUri: connectionUri.data.uri,
            });

            await restoreBranch({
              appId,
              targetCommitHash: versionId,
              neonProjectId: app.neonProjectId,
              branchIdToUpdate: app.neonPreviewBranchId,
            });
          }
        }
        const fullAppPath = getDyadAppPath(app.path);
        await gitCheckout({
          path: fullAppPath,
          ref: versionId,
        });
      });
    },
  );

  handle(
    "mark-favorite",
    async (
      _,
      { appId, commitHash }: { appId: number; commitHash: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        // Throw an error if there are more than three versions which are favorite and have a Neon branch
        const favoriteVersionsWithBranch = await db.query.versions.findMany({
          where: and(eq(versions.appId, appId), eq(versions.isFavorite, true)),
        });

        const favoriteVersionsWithNeonBranch =
          favoriteVersionsWithBranch.filter(
            (version) => version.neonBranchId !== null,
          );

        // Check if marking this version as favorite would exceed the limit
        const existingVersion = await db.query.versions.findFirst({
          where: and(
            eq(versions.appId, appId),
            eq(versions.commitHash, commitHash),
          ),
        });

        // If this is not already a favorite version with a Neon branch, check the limit
        const wouldExceedLimit =
          !existingVersion?.isFavorite &&
          favoriteVersionsWithNeonBranch.length >= 3;

        if (app.neonProjectId && wouldExceedLimit) {
          throw new Error(
            `Cannot mark version ${commitHash} as favorite: Maximum of 3 favorite versions with Neon branches allowed. Currently have ${favoriteVersionsWithNeonBranch.length} favorite versions.`,
          );
        }

        // existingVersion is already declared above for the limit check

        if (existingVersion) {
          // If marking as favorite and there is no Neon branch associated, throw an error
          if (app.neonProjectId && !existingVersion.neonBranchId) {
            throw new Error(
              `Cannot mark version ${commitHash} as favorite: No Neon branch associated with this version`,
            );
          }

          // Update existing version
          await db
            .update(versions)
            .set({
              isFavorite: true,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(versions.appId, appId),
                eq(versions.commitHash, commitHash),
              ),
            );
        } else {
          // Create new version record as favorite
          // Note: neonBranchId will be null initially and should be set when a Neon branch is created
          await db.insert(versions).values({
            appId,
            commitHash,
            isFavorite: true,
            neonBranchId: null,
          });
        }

        logger.info(`Marked commit ${commitHash} as favorite for app ${appId}`);
      });
    },
  );

  handle(
    "unmark-favorite",
    async (
      _,
      { appId, commitHash }: { appId: number; commitHash: string },
    ): Promise<void> => {
      return withLock(appId, async () => {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        // Find the version record
        const existingVersion = await db.query.versions.findFirst({
          where: and(
            eq(versions.appId, appId),
            eq(versions.commitHash, commitHash),
          ),
        });

        // If there's a Neon branch associated with this version, delete it first
        if (existingVersion?.neonBranchId && app.neonProjectId) {
          try {
            const neonClient = await getNeonClient();
            await neonClient.deleteProjectBranch(
              app.neonProjectId,
              existingVersion.neonBranchId,
            );
            logger.info(
              `Deleted Neon branch ${existingVersion.neonBranchId} for commit ${commitHash}`,
            );
          } catch (neonError) {
            const errorMessage = getNeonErrorMessage(neonError);
            throw new Error(`Failed to delete Neon branch: ${errorMessage}`);
          }
        }

        if (existingVersion) {
          // Update the version to not be a favorite and clear the Neon branch ID
          await db
            .update(versions)
            .set({
              isFavorite: false,
              neonBranchId: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(versions.appId, appId),
                eq(versions.commitHash, commitHash),
              ),
            );
        } else {
          // Handle the case where the version might not exist already in the DB table
          // Create a new version record marked as not favorite
          await db.insert(versions).values({
            appId,
            commitHash,
            isFavorite: false,
            neonBranchId: null,
          });
        }

        logger.info(
          `Unmarked commit ${commitHash} as favorite for app ${appId}`,
        );
      });
    },
  );
}

async function switchPostgresToDevelopmentBranch({
  neonProjectId,
  neonDevelopmentBranchId,
  appPath,
}: {
  neonProjectId: string;
  neonDevelopmentBranchId: string;
  appPath: string;
}) {
  // SWITCH the env var for POSTGRES_URL to the development branch
  const neonClient = await getNeonClient();
  const connectionUri = await neonClient.getConnectionUri({
    projectId: neonProjectId,
    branch_id: neonDevelopmentBranchId,
    // This is the default database name for Neon
    database_name: "neondb",
    // This is the default role name for Neon
    role_name: "neondb_owner",
  });

  await updatePostgresUrlEnvVar({
    appPath,
    connectionUri: connectionUri.data.uri,
  });
}
