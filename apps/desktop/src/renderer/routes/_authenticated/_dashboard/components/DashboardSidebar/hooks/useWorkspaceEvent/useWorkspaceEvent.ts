import { getEventBus } from "@superset/workspace-client";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useEffectEvent, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceWsToken } from "renderer/lib/host-service-auth";
import { getRemoteHostUrl } from "renderer/lib/v2-workspace-host";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useHostService } from "renderer/routes/_authenticated/providers/HostServiceProvider";

/**
 * Subscribe to an event bus event for a workspace.
 * Resolves the workspace's host and connects to the correct event bus automatically.
 */
export function useWorkspaceEvent(
	type: "git:changed",
	workspaceId: string,
	callback: () => void,
	enabled = true,
): void {
	const hostUrl = useWorkspaceHostUrl(workspaceId);
	const handler = useEffectEvent(callback);

	useEffect(() => {
		if (!enabled || !hostUrl) return;

		const bus = getEventBus(hostUrl, () => getHostServiceWsToken(hostUrl));
		const removeListener = bus.on(type, workspaceId, () => handler());
		const release = bus.retain();

		return () => {
			removeListener();
			release();
		};
	}, [enabled, hostUrl, type, workspaceId]);
}

/**
 * Resolves a workspace ID to its host-service URL.
 * Local host → localhost port. Remote host → relay proxy URL.
 */
export function useWorkspaceHostUrl(workspaceId: string): string | null {
	const collections = useCollections();
	const { services } = useHostService();
	const { data: deviceInfo } = electronTrpc.auth.getDeviceInfo.useQuery();

	const { data: workspaceWithHost = [] } = useLiveQuery(
		(q) =>
			q
				.from({ workspaces: collections.v2Workspaces })
				.innerJoin({ hosts: collections.v2Hosts }, ({ workspaces, hosts }) =>
					eq(workspaces.hostId, hosts.id),
				)
				.where(({ workspaces }) => eq(workspaces.id, workspaceId))
				.select(({ workspaces, hosts }) => ({
					hostId: workspaces.hostId,
					hostMachineId: hosts.machineId,
					hostOrgId: hosts.organizationId,
				})),
		[collections, workspaceId],
	);

	const match = workspaceWithHost[0] ?? null;

	return useMemo(() => {
		if (!match) return null;
		if (match.hostMachineId === deviceInfo?.deviceId) {
			return services.get(match.hostOrgId)?.url ?? null;
		}
		return getRemoteHostUrl(match.hostId);
	}, [match, deviceInfo?.deviceId, services]);
}
