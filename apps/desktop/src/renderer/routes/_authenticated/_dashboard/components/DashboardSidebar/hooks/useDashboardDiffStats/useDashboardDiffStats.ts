import { getEventBus } from "@superset/workspace-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHostServiceWsToken } from "renderer/lib/host-service-auth";
import type { HostServiceClient } from "renderer/lib/host-service-client";

export interface DiffStats {
	additions: number;
	deletions: number;
}

export function useDashboardDiffStats(
	localWorkspaceIds: string[],
	hostUrl: string | null,
	client: HostServiceClient | null,
): Map<string, DiffStats> {
	const [statsMap, setStatsMap] = useState<Map<string, DiffStats>>(
		() => new Map(),
	);
	const clientRef = useRef(client);
	clientRef.current = client;

	const fetchDiffStats = useCallback(async (workspaceId: string) => {
		const currentClient = clientRef.current;
		if (!currentClient) return;

		try {
			const status = await currentClient.git.getStatus.query({
				workspaceId,
			});

			let additions = 0;
			let deletions = 0;
			for (const file of status.againstBase) {
				additions += file.additions;
				deletions += file.deletions;
			}
			for (const file of status.staged) {
				additions += file.additions;
				deletions += file.deletions;
			}
			for (const file of status.unstaged) {
				additions += file.additions;
				deletions += file.deletions;
			}

			setStatsMap((prev) => {
				const next = new Map(prev);
				next.set(workspaceId, { additions, deletions });
				return next;
			});
		} catch {
			// Workspace might have been deleted or host-service unavailable
		}
	}, []);

	// Fetch initial data for all workspaces
	useEffect(() => {
		if (!hostUrl || !client || localWorkspaceIds.length === 0) return;

		for (const id of localWorkspaceIds) {
			void fetchDiffStats(id);
		}
	}, [client, fetchDiffStats, hostUrl, localWorkspaceIds]);

	// Subscribe to git:changed events and refetch on change
	useEffect(() => {
		if (!hostUrl || localWorkspaceIds.length === 0) return;

		const bus = getEventBus(hostUrl, () => getHostServiceWsToken(hostUrl));
		const workspaceIdSet = new Set(localWorkspaceIds);

		const removeListener = bus.on("git:changed", "*", (workspaceId) => {
			if (workspaceIdSet.has(workspaceId)) {
				void fetchDiffStats(workspaceId);
			}
		});

		const release = bus.retain();

		return () => {
			removeListener();
			release();
		};
	}, [fetchDiffStats, hostUrl, localWorkspaceIds]);

	// Clean up stale entries when workspace list changes
	useEffect(() => {
		const idSet = new Set(localWorkspaceIds);
		setStatsMap((prev) => {
			let changed = false;
			const next = new Map(prev);
			for (const key of next.keys()) {
				if (!idSet.has(key)) {
					next.delete(key);
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [localWorkspaceIds]);

	return statsMap;
}
