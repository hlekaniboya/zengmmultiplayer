import Bugsnag from "@bugsnag/browser";
import { PWBHost } from "promise-worker-bi";

const workerPath =
	process.env.NODE_ENV === "production"
		? `/gen/worker-${window.bbgmVersion}.js`
		: "/gen/worker.js";
const worker = window.useSharedWorker
	? new SharedWorker(workerPath, { type: "module" })
	: new Worker(workerPath, { type: "module" });

export const promiseWorker = new PWBHost(worker);
promiseWorker.registerError((error) => {
	Bugsnag.notify(error);

	console.error("Error from worker:");
	console.error(error);
});

let promiseQueue = Promise.resolve<any>(undefined);

export const enqueueWorkerTask = <T>(task: () => Promise<T> | T): Promise<T> => {
	const nextPromise = promiseQueue.then(task);
	promiseQueue = nextPromise.catch(() => {}); // Prevent queue from breaking on errors
	return nextPromise;
};
