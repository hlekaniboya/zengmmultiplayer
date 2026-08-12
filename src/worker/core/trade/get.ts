import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import type { Trade } from "../../../common/types.ts";

const get = async (): Promise<Trade> => {
	const userTid = g.get("userTid");
	let tr = await idb.cache.trade.get(userTid);
	if (!tr) {
		const defaultTrade = await idb.cache.trade.get(0);
		tr = {
			rid: userTid,
			teams: [
				{
					tid: userTid,
					pids: [],
					pidsExcluded: [],
					dpids: [],
					dpidsExcluded: [],
				},
				{
					tid: defaultTrade ? defaultTrade.teams[1].tid : (userTid === 0 ? 1 : 0),
					pids: [],
					pidsExcluded: [],
					dpids: [],
					dpidsExcluded: [],
				},
			],
		};
		await idb.cache.trade.put(tr);
	}
	return tr;
};

export default get;
