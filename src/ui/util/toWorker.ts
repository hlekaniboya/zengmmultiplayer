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
	
	// Proxy Guest worker calls to Host when in multiplayer, EXCEPT on the main leagues list or new league creation pages
	const isNonLeaguePage = window.location.pathname === "/" || window.location.pathname.startsWith("/new_league");
	const shouldProxy = state.isMultiplayer && !isNonLeaguePage;

	if (shouldProxy) {
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
