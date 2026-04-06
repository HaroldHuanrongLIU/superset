import type { ActivePaneStatus } from "shared/tabs-types";

export interface WorkspaceRowMockData {
	workspaceStatus: ActivePaneStatus | null;
}

function getSeed(input: string): number {
	return [...input].reduce(
		(seed, character, index) => seed + character.charCodeAt(0) * (index + 1),
		0,
	);
}

export function getWorkspaceRowMocks(
	workspaceId: string,
): WorkspaceRowMockData {
	const seed = getSeed(workspaceId);
	const paneStatuses: ActivePaneStatus[] = ["permission", "working", "review"];
	const status =
		seed % 6 === 0 ? paneStatuses[seed % paneStatuses.length] : null;

	return {
		workspaceStatus: status,
	};
}
