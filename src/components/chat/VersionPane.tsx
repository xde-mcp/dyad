import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom, selectedVersionIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { useFavorites } from "@/hooks/useFavorites";
import { formatDistanceToNow } from "date-fns";
import { RotateCcw, X, Star, Database } from "lucide-react";
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

interface VersionPaneProps {
  isVisible: boolean;
  onClose: () => void;
}

export function VersionPane({ isVisible, onClose }: VersionPaneProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { refreshApp } = useLoadApp(appId);
  const {
    versions: liveVersions,
    refreshVersions,
    revertVersion,
  } = useVersions(appId);
  const { isFavorited, toggleFavorite, isUpdatingFavorite } =
    useFavorites(appId);
  const [selectedVersionId, setSelectedVersionId] = useAtom(
    selectedVersionIdAtom,
  );
  const { checkoutVersion, isCheckingOutVersion } = useCheckoutVersion();
  const wasVisibleRef = useRef(false);
  const [cachedVersions, setCachedVersions] = useState<Version[]>([]);

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

  const handleVersionClick = async (versionOid: string) => {
    if (appId) {
      setSelectedVersionId(versionOid);
      try {
        await checkoutVersion({ appId, versionId: versionOid });
      } catch (error) {
        console.error("Could not checkout version, unselecting version", error);
        setSelectedVersionId(null);
      }
      await refreshApp();
    }
  };

  const versions = cachedVersions.length > 0 ? cachedVersions : liveVersions;

  return (
    <div className="h-full border-t border-2 border-border w-full">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-semibold pl-2">Version History</h2>
        <button
          onClick={onClose}
          className="p-1 hover:bg-(--background-lightest) rounded-md  "
          aria-label="Close version pane"
        >
          <X size={20} />
        </button>
      </div>
      <div className="overflow-y-auto h-[calc(100%-60px)]">
        {versions.length === 0 ? (
          <div className="p-4 ">No versions available</div>
        ) : (
          <div className="divide-y divide-border">
            {versions.map((version: Version, index) => (
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
                    handleVersionClick(version.oid);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs">
                      Version {versions.length - index}
                    </span>
                    {version.hasDbSnapshot && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-md">
                            <Database size={10} />
                            <span>DB</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          Database snapshot available
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <span className="text-xs opacity-90">
                    {formatDistanceToNow(new Date(version.timestamp * 1000), {
                      addSuffix: true,
                    })}
                  </span>
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
                              const targetIndex = versions.findIndex(
                                (v) => v.oid === hash,
                              );
                              return targetIndex !== -1
                                ? `Reverted all changes back to version ${
                                    versions.length - targetIndex
                                  }`
                                : version.message;
                            },
                          )
                        : version.message}
                    </p>
                  )}

                  <div className="flex items-center gap-1">
                    {/* Star button for favorites */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!isUpdatingFavorite) {
                              await toggleFavorite(version.oid);
                            }
                          }}
                          disabled={isUpdatingFavorite}
                          className={cn(
                            "p-1 rounded-md transition-colors hover:bg-(--background-lightest)",
                            isFavorited(version.oid)
                              ? "text-yellow-500"
                              : "text-gray-400 hover:text-yellow-500",
                            isUpdatingFavorite &&
                              "opacity-50 cursor-not-allowed",
                          )}
                          aria-label={
                            isFavorited(version.oid)
                              ? "Remove from favorites"
                              : "Add to favorites"
                          }
                        >
                          <Star
                            size={14}
                            fill={
                              isFavorited(version.oid) ? "currentColor" : "none"
                            }
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isFavorited(version.oid)
                          ? "Remove from favorites"
                          : "Add to favorites"}
                      </TooltipContent>
                    </Tooltip>

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
                            // Close the pane after revert to force a refresh on next open
                            onClose();
                          }}
                          className={cn(
                            "invisible mt-1 flex items-center gap-1 px-2 py-0.5 text-sm font-medium bg-(--primary) text-(--primary-foreground) hover:bg-background-lightest rounded-md transition-colors",
                            selectedVersionId === version.oid && "visible",
                          )}
                          aria-label="Restore to this version"
                        >
                          <RotateCcw size={12} />
                          <span>Restore</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Restore to this version</TooltipContent>
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
