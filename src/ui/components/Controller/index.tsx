import { LazyMotion } from "framer-motion";
import { memo, useCallback, useEffect, useState } from "react";
import { localActions, useLocal } from "../../util/local.ts";
import { CommandPalette } from "../CommandPalette/index.tsx";
import { Footer } from "./Footer.tsx";
import { Header } from "./Header.tsx";
import { LeagueTopBar } from "./LeagueTopBar.tsx";
import { MultiTeamMenu } from "./MultiTeamMenu.tsx";
import { NagModal } from "./NagModal.tsx";
import { NavBar } from "./NavBar.tsx";
import { Notifications } from "./Notifications.tsx";
import { SideBar } from "./SideBar.tsx";
import { Skyscraper } from "./Skyscraper.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { useViewData } from "../../util/viewManager.tsx";
import { isSport } from "../../../common/sportFunctions.ts";
import api from "../../api/index.ts";
import { ErrorBoundary } from "../ErrorBoundary.tsx";
import { 
  subscribeMultiplayerState, 
  setPlayerReadyToAdvance 
} from "../../util/multiplayer.ts";
import type { MultiplayerState } from "../../util/multiplayer.ts";

const loadFramerMotionFeatures = () =>
	import("../../util/framerMotionFeatures.ts").then((res) => res.default);

const minHeight100 = {
	// Just using h-100 class here results in the sticky ad in the skyscraper becoming unstuck after scrolling down 100% of the viewport, for some reason
	minHeight: "100%",
};

const minWidth0 = {
	// Fix for responsive table not being triggered by flexbox limits, and skyscraper ad overflowing content https://stackoverflow.com/a/36247448/786644
	minWidth: 0,
};

type KeepPreviousRenderWhileUpdatingProps = {
	children: any;
	updating: boolean;
};
const KeepPreviousRenderWhileUpdating = memo(
	(props: KeepPreviousRenderWhileUpdatingProps) => {
		return props.children;
	},
	(
		prevProps: KeepPreviousRenderWhileUpdatingProps,
		nextProps: KeepPreviousRenderWhileUpdatingProps,
	) => {
		// No point in rendering while updating contents
		return nextProps.updating;
	},
);

export const Controller = () => {
	const state = useViewData();

	const { popup, showNagModal } = useLocal(["popup", "showNagModal"]);

	const [mState, setMState] = useState<MultiplayerState>({
		isMultiplayer: false,
		role: null,
		roomId: null,
		statusMessage: "",
		hostTid: 0,
		guestTid: 1,
		lid: null,
		hostReady: false,
		guestReady: false,
		advanceOption: null,
	});

	useEffect(() => {
		const unsubscribe = subscribeMultiplayerState((newState) => {
			setMState(newState);
		});
		return () => unsubscribe();
	}, []);

	const closeNagModal = useCallback(() => {
		localActions.update({
			showNagModal: false,
		});
	}, []);

	useEffect(() => {
		if (popup) {
			document.body.style.paddingTop = "8px";
			const css = document.createElement("style");
			css.innerHTML = ".new_window { display: none }";
			document.body.append(css);
		}
	}, [popup]);

	useEffect(() => {
		// Try to show ads on initial render
		api.initAds("uiRendered");
	}, []);

	const {
		Component,
		data,
		idLoading,
		idLoaded,
		inLeague,
		loading: updating,
		scrollToTop,
	} = state;

	// Optimistically use idLoading before it renders, for UI responsiveness in the sidebar
	const sidebarPageID = idLoading ?? idLoaded;

	const pathname = isSport("baseball") ? document.location.pathname : undefined;

	// Scroll to top if this load came from user clicking a link to a new page
	useEffect(() => {
		if (scrollToTop) {
			window.scrollTo(window.pageXOffset, 0);
		}
	}, [idLoaded, scrollToTop]);

	return (
		<LazyMotion strict features={loadFramerMotionFeatures}>
			<NavBar updating={updating} />
			<div className="h-100 d-flex">
				<SideBar pageID={sidebarPageID} pathname={pathname} />
				<div className="h-100 w-100 d-flex flex-column" style={minWidth0}>
					{popup ? null : <LeagueTopBar />}
					<TitleBar />
					<div className="container-fluid position-relative mt-2 flex-grow-1 h-100">
						<div className="d-flex" style={minHeight100}>
							<div className="w-100 d-flex flex-column" style={minWidth0}>
								<Header />
								<main id="actual-actual-content" className="clearfix">
									<ErrorBoundary key={idLoaded}>
										{Component ? (
											<KeepPreviousRenderWhileUpdating updating={updating}>
												<Component {...data} />
											</KeepPreviousRenderWhileUpdating>
										) : null}
										{inLeague ? <MultiTeamMenu /> : null}
									</ErrorBoundary>
								</main>
								<Footer />
							</div>
							<Skyscraper />
						</div>
						<CommandPalette />
						<NagModal close={closeNagModal} show={showNagModal} />
					</div>
				</div>
			</div>
			<Notifications />
			{mState.isMultiplayer && (mState.hostReady || mState.guestReady) && (
				<div 
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						width: "100%",
						height: "100%",
						backgroundColor: "rgba(0,0,0,0.75)",
						backdropFilter: "blur(5px)",
						zIndex: 9999,
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						color: "#fff"
					}}
				>
					<div className="card text-dark text-center p-4 m-3" style={{ maxWidth: "450px", borderRadius: "10px" }}>
						<div className="card-body">
							<h3 className="card-title text-primary mb-3">Multiplayer Advance</h3>
							<p className="lead fs-5 mb-4">
								{mState.role === "host" ? (
									mState.hostReady && !mState.guestReady ? (
										<span>Waiting for Player 2 (Guest) to agree to advance...</span>
									) : (
										<span>Player 2 wants to advance!</span>
									)
								) : (
									mState.guestReady && !mState.hostReady ? (
										<span>Waiting for Player 1 (Host) to agree to advance...</span>
									) : (
										<span>Player 1 wants to advance!</span>
									)
								)}
							</p>
							<div className="bg-light p-3 border rounded mb-4 font-monospace fs-6">
								<strong>Advance action:</strong> Play {mState.advanceOption || "1 Day"}
							</div>
							
							<div className="d-flex justify-content-center gap-3">
								{mState.role === "host" && !mState.hostReady && (
									<button 
										className="btn btn-success btn-lg"
										onClick={() => setPlayerReadyToAdvance(true)}
									>
										Agree & Advance
									</button>
								)}
								{mState.role === "guest" && !mState.guestReady && (
									<button 
										className="btn btn-success btn-lg"
										onClick={() => setPlayerReadyToAdvance(true)}
									>
										Agree & Advance
									</button>
								)}
								<button 
									className="btn btn-secondary btn-lg"
									onClick={() => setPlayerReadyToAdvance(false)}
								>
									Cancel / Decline
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</LazyMotion>
	);
};
