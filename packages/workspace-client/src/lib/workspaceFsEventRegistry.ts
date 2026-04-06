import type { FsWatchEvent } from "@superset/workspace-fs/host";
import { getEventBus } from "./eventBus";

export type WorkspaceFsEventListener = (event: FsWatchEvent) => void;

interface WorkspaceFsSubscriptionState {
	bridgeCount: number;
	hostUrl: string;
	getWsToken: () => string | null;
	listeners: Set<WorkspaceFsEventListener>;
	workspaceId: string;
	removeBusListener: (() => void) | null;
	watching: boolean;
}

const subscriptions = new Map<string, WorkspaceFsSubscriptionState>();

function getSubscriptionKey(hostUrl: string, workspaceId: string): string {
	return `${hostUrl}:${workspaceId}`;
}

function getOrCreateSubscription(
	hostUrl: string,
	getWsToken: () => string | null,
	workspaceId: string,
): WorkspaceFsSubscriptionState {
	const key = getSubscriptionKey(hostUrl, workspaceId);
	const existing = subscriptions.get(key);
	if (existing) {
		return existing;
	}

	const nextState: WorkspaceFsSubscriptionState = {
		bridgeCount: 0,
		hostUrl,
		getWsToken,
		listeners: new Set<WorkspaceFsEventListener>(),
		workspaceId,
		removeBusListener: null,
		watching: false,
	};
	subscriptions.set(key, nextState);
	return nextState;
}

function removeSubscriptionIfInactive(
	state: WorkspaceFsSubscriptionState,
): void {
	if (state.bridgeCount > 0 || state.listeners.size > 0) {
		return;
	}

	// Stop watching fs for this workspace
	if (state.watching) {
		const bus = getEventBus(state.hostUrl, state.getWsToken);
		bus.unwatchFs(state.workspaceId);
		state.watching = false;
	}

	// Remove bus listener
	state.removeBusListener?.();
	state.removeBusListener = null;

	subscriptions.delete(getSubscriptionKey(state.hostUrl, state.workspaceId));
}

function ensureTransport(state: WorkspaceFsSubscriptionState): void {
	if (state.removeBusListener) {
		return;
	}

	if (state.bridgeCount === 0 && state.listeners.size === 0) {
		return;
	}

	const bus = getEventBus(state.hostUrl, state.getWsToken);

	// Listen for fs events on the event bus for this workspace
	state.removeBusListener = bus.on(
		"fs:events",
		state.workspaceId,
		(_workspaceId, payload) => {
			for (const event of payload.events) {
				for (const listener of state.listeners) {
					listener(event);
				}
			}
		},
	);

	// Tell the server to start watching this workspace's filesystem
	bus.watchFs(state.workspaceId);
	state.watching = true;
}

export interface FsEventRegistryClient {
	hostUrl: string;
	getWsToken: () => string | null;
}

export function retainWorkspaceFsBridge(
	client: FsEventRegistryClient,
	workspaceId: string,
): () => void {
	const state = getOrCreateSubscription(
		client.hostUrl,
		client.getWsToken,
		workspaceId,
	);
	state.bridgeCount += 1;
	ensureTransport(state);

	return () => {
		state.bridgeCount = Math.max(0, state.bridgeCount - 1);
		removeSubscriptionIfInactive(state);
	};
}

export function subscribeToWorkspaceFsEvents(
	client: FsEventRegistryClient,
	workspaceId: string,
	listener: WorkspaceFsEventListener,
): () => void {
	const state = getOrCreateSubscription(
		client.hostUrl,
		client.getWsToken,
		workspaceId,
	);
	state.listeners.add(listener);
	ensureTransport(state);

	return () => {
		state.listeners.delete(listener);
		removeSubscriptionIfInactive(state);
	};
}
