import { promiseWorker, enqueueWorkerTask } from "./promiseWorker.ts";
import type { WorkerAPICategory } from "../../worker/index.ts";
import type api from "../../worker/api/index.ts";
import { getMultiplayerState, toWorkerGuest, setPlayerReadyToAdvance } from "./multiplayer.ts";

type API = typeof api;

// https://stackoverflow.com/a/70818666/786644
type ParametersUnconstrained<T> = T extends (...args: infer P) => any
	? P
	: never;
type ReturnTypeUnconstrained<T> = T extends (...args: any) => infer P
	? P
	: never;

export const toWorker = <
	Type extends WorkerAPICategory,
	Name extends keyof API[Type],
	Func extends API[Type][Name],
>(
	type: Type,
	name: Name,
	param: ParametersUnconstrained<Func>[0],
): Promise<ReturnTypeUnconstrained<Func>> => {
	const state = getMultiplayerState();
	
	// Only proxy Guest worker calls to the Host's worker if the Guest is actively on a league page
	const isInLeaguePage = window.location.pathname.startsWith("/l/");

	if (state.isMultiplayer && isInLeaguePage) {
		if (type === "playMenu") {
			// Intercept and route through turn-agreement coordination
			setPlayerReadyToAdvance(true, name as string);
			return Promise.resolve(undefined as any);
		}

		if (state.role === "guest") {
			return toWorkerGuest([type, name, param]);
		}
	}
	return enqueueWorkerTask(() => promiseWorker.postMessage([type, name, param]));
};
