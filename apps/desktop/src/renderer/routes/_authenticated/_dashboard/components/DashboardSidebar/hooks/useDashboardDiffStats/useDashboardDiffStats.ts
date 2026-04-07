import { getEventBus } from "@superset/workspace-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHostServiceWsToken } from "renderer/lib/host-service-auth";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

export interface DiffStats {
	additions: number;
	deletions: number;
}

export interface WorkspaceHostInfo {
	workspaceId: string;
	hostUrl: string;
}

export function useDashboardDiffStats(
	workspaceHosts: WorkspaceHostInfo[],
): Map<string, DiffStats> {
	const [statsMap, setStatsMap] = useState<Map<string, DiffStats>>(
		() => new Map(),
	);

	const fetchDiffStats = useCallback(
		async (workspaceId: string, hostUrl: string) => {
			try {
				const client = getHostServiceClientByUrl(hostUrl);
				const status = await client.git.getStatus.query({ workspaceId });

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
		},
		[],
	);

	// Stable serialization key for the workspace-host list
	const _workspaceHostsKey = workspaceHosts
		.map((wh) => `${wh.workspaceId}:${wh.hostUrl}`)
		.join(",");

	// Keep a ref so event handlers can access current mapping
	const workspaceHostsRef = useRef(workspaceHosts);
	workspaceHostsRef.current = workspaceHosts;

	// Fetch initial data for all workspaces
	useEffect(() => {
		for (const { workspaceId, hostUrl } of workspaceHosts) {
			void fetchDiffStats(workspaceId, hostUrl);
		}
	}, [fetchDiffStats, workspaceHosts]);

	// Subscribe to git:changed events per unique host
	useEffect(() => {
		if (workspaceHosts.length === 0) return;

		// Group workspaces by hostUrl
		const byHost = new Map<string, Set<string>>();
		for (const { workspaceId, hostUrl } of workspaceHosts) {
			let set = byHost.get(hostUrl);
			if (!set) {
				set = new Set();
				byHost.set(hostUrl, set);
			}
			set.add(workspaceId);
		}

		const cleanups: Array<() => void> = [];

		for (const [hostUrl, workspaceIds] of byHost) {
			const bus = getEventBus(hostUrl, () => getHostServiceWsToken(hostUrl));

			const removeListener = bus.on(
				"git:changed",
				"*",
				(changedWorkspaceId) => {
					if (workspaceIds.has(changedWorkspaceId)) {
						void fetchDiffStats(changedWorkspaceId, hostUrl);
					}
				},
			);

			const release = bus.retain();
			cleanups.push(removeListener, release);
		}

		return () => {
			for (const cleanup of cleanups) {
				cleanup();
			}
		};
	}, [fetchDiffStats, workspaceHosts]);

	// Clean up stale entries when workspace list changes
	useEffect(() => {
		const idSet = new Set(workspaceHosts.map((wh) => wh.workspaceId));
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
	}, [workspaceHosts.map]);

	return statsMap;
}
