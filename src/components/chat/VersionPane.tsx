import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom, selectedVersionIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { useFavorites } from "@/hooks/useFavorites";
import { formatDistanceToNow } from "date-fns";
import { RotateCcw, X, Star, Database, Loader2, List } from "lucide-react";
import type { Version } from "@/ipc/ipc_types";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useCheckoutVersion } from "@/hooks/useCheckoutVersion";
import { useLoadApp } from "@/hooks/useLoadApp";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useRunApp } from "@/hooks/useRunApp";

interface VersionPaneProps {
  isVisible: boolean;
  onClose: () => void;
}

export function VersionPane({ isVisible, onClose }: VersionPaneProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { refreshApp } = useLoadApp(appId);
  const { restartApp } = useRunApp();
  const {
    versions: liveVersions,
    refreshVersions,
    revertVersion,
    isRevertingVersion,
  } = useVersions(appId);
  const { markFavorite, unmarkFavorite, isUpdatingFavorite } =
    useFavorites(appId);
  const [selectedVersionId, setSelectedVersionId] = useAtom(
    selectedVersionIdAtom,
  );
  const { checkoutVersion, isCheckingOutVersion } = useCheckoutVersion();
  const wasVisibleRef = useRef(false);
  const [cachedVersions, setCachedVersions] = useState<Version[]>([]);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);

  useEffect(() => {
    async function updatePaneState() {
      // When pane becomes visible after being closed
      if (isVisible && !wasVisibleRef.current) {
        if (appId) {
          await refreshVersions();
          setCachedVersions(liveVersions);
        }
      }

      // Reset when closing
      if (!isVisible && selectedVersionId) {
        setSelectedVersionId(null);
        if (appId) {
          await checkoutVersion({ appId, versionId: "main" });
        }
      }
      if (!isVisible) {
        setShowOnlyFavorites(false);
      }

      wasVisibleRef.current = isVisible;
    }
    updatePaneState();
  }, [
    isVisible,
    selectedVersionId,
    setSelectedVersionId,
    appId,
    checkoutVersion,
    refreshVersions,
    liveVersions,
  ]);

  // Initial load of cached versions when live versions become available
  useEffect(() => {
    if (isVisible && liveVersions.length > 0 && cachedVersions.length === 0) {
      setCachedVersions(liveVersions);
    }
  }, [isVisible, liveVersions, cachedVersions.length]);

  if (!isVisible) {
    return null;
  }

  const handleVersionClick = async (version: Version) => {
    if (appId) {
      setSelectedVersionId(version.oid);
      try {
        await checkoutVersion({ appId, versionId: version.oid });
      } catch (error) {
        console.error("Could not checkout version, unselecting version", error);
        setSelectedVersionId(null);
      }
      await refreshApp();
      if (version.dbBranch) {
        await restartApp();
      }
    }
  };

  const isFavorite = (version: Version) => {
    return liveVersions.find((v) => v.oid === version.oid)?.isFavorite;
  };

  const allVersions = cachedVersions.length > 0 ? cachedVersions : liveVersions;
  const versions = showOnlyFavorites
    ? allVersions.filter((version) => isFavorite(version))
    : allVersions;

  console.log("versions", versions);

  return (
    <div className="h-full border-t border-2 border-border w-full">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-medium pl-2">Version History</h2>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
            variant="outline"
            size="sm"
            className="text-xs"
          >
            {showOnlyFavorites ? (
              <List size={12} className="mr-1" />
            ) : (
              <Star size={12} className="mr-1" fill="none" />
            )}
            {showOnlyFavorites ? "Show all" : "Show favorites"}
          </Button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-(--background-lightest) rounded-md  "
            aria-label="Close version pane"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto h-[calc(100%-60px)]">
        {versions.length === 0 ? (
          <div className="p-4 ">
            {showOnlyFavorites
              ? "No favorite versions available"
              : "No versions available"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {versions.map((version: Version) => (
              <div
                key={version.oid}
                className={cn(
                  "px-4 py-2 hover:bg-(--background-lightest) cursor-pointer",
                  selectedVersionId === version.oid &&
                    "bg-(--background-lightest)",
                  isCheckingOutVersion &&
                    selectedVersionId === version.oid &&
                    "opacity-50 cursor-not-allowed",
                )}
                onClick={() => {
                  if (!isCheckingOutVersion) {
                    handleVersionClick(version);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs">
                      Version{" "}
                      {allVersions.length -
                        allVersions.findIndex(
                          (v) => v.oid === version.oid,
                        )}{" "}
                      ({version.oid.slice(0, 7)})
                    </span>
                    {/* Star button for favorites */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!isUpdatingFavorite) {
                              if (isFavorite(version)) {
                                await unmarkFavorite(version.oid);
                              } else {
                                await markFavorite(version.oid);
                              }
                            }
                          }}
                          disabled={isUpdatingFavorite}
                          className={cn(
                            "p-1 rounded-md transition-colors hover:bg-(--background-lightest)",
                            isFavorite(version)
                              ? "text-yellow-500"
                              : "text-gray-400 hover:text-yellow-500",
                            isUpdatingFavorite &&
                              "opacity-50 cursor-not-allowed",
                          )}
                          aria-label={
                            isFavorite(version)
                              ? "Remove from favorites"
                              : "Add to favorites"
                          }
                        >
                          <Star
                            size={14}
                            fill={isFavorite(version) ? "currentColor" : "none"}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isFavorite(version)
                          ? "Remove from favorites"
                          : "Add to favorites"}
                      </TooltipContent>
                    </Tooltip>
                    {version.dbBranch && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-md">
                            <Database size={10} />
                            <span>DB</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          Database snapshot available at branch{" "}
                          {version.dbBranch}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isCheckingOutVersion &&
                      selectedVersionId === version.oid && (
                        <Loader2
                          size={12}
                          className="animate-spin text-primary"
                        />
                      )}
                    <span className="text-xs opacity-90">
                      {isCheckingOutVersion && selectedVersionId === version.oid
                        ? "Loading..."
                        : formatDistanceToNow(
                            new Date(version.timestamp * 1000),
                            {
                              addSuffix: true,
                            },
                          )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {version.message && (
                    <p className="mt-1 text-sm">
                      {version.message.startsWith(
                        "Reverted all changes back to version ",
                      )
                        ? version.message.replace(
                            /Reverted all changes back to version ([a-f0-9]+)/,
                            (_, hash) => {
                              const targetIndex = allVersions.findIndex(
                                (v) => v.oid === hash,
                              );
                              return targetIndex !== -1
                                ? `Reverted all changes back to version ${
                                    allVersions.length - targetIndex
                                  }`
                                : version.message;
                            },
                          )
                        : version.message}
                    </p>
                  )}

                  <div className="flex items-center gap-1">
                    {/* Restore button */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setSelectedVersionId(null);
                            await revertVersion({
                              versionId: version.oid,
                            });
                            if (version.dbBranch) {
                              // Intentionally do not await because this takes a long time
                              // and we want to close the pane immediately
                              restartApp();
                            }
                            // Close the pane after revert to force a refresh on next open
                            onClose();
                          }}
                          disabled={isRevertingVersion}
                          className={cn(
                            "invisible mt-1 flex items-center gap-1 px-2 py-0.5 text-sm font-medium bg-(--primary) text-(--primary-foreground) hover:bg-background-lightest rounded-md transition-colors",
                            selectedVersionId === version.oid && "visible",
                            isRevertingVersion &&
                              "opacity-50 cursor-not-allowed",
                          )}
                          aria-label="Restore to this version"
                        >
                          {isRevertingVersion ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          <span>
                            {isRevertingVersion ? "Restoring..." : "Restore"}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isRevertingVersion
                          ? "Restoring to this version..."
                          : "Restore to this version"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
