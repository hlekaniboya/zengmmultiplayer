import { io, Socket } from "socket.io-client";
import { promiseWorker, enqueueWorkerTask } from "./promiseWorker.ts";
import api from "../api/index.ts";
import { router } from "../router/index.ts";
import type { TradeTeams } from "../../common/types.ts";
import { showNotification } from "./showNotification.ts";
import { toWorker } from "./toWorker.ts";
import { realtimeUpdate } from "./realtimeUpdate.ts";

export interface MultiplayerState {
  isMultiplayer: boolean;
  role: "host" | "guest" | null;
  roomId: string | null;
  statusMessage: string;
  hostTid: number;
  guestTid: number;
  lid: number | null;
  hostReady: boolean;
  guestReady: boolean;
  advanceOption: string | null;
  pendingTrade: TradeTeams | null;
  currentWorkerTid: number;
}

let socket: Socket | null = null;
let state: MultiplayerState = {
  isMultiplayer: false,
  role: null,
  roomId: null,
  statusMessage: "Not connected",
  hostTid: 0,
  guestTid: 1,
  lid: null,
  hostReady: false,
  guestReady: false,
  advanceOption: null,
  pendingTrade: null,
  currentWorkerTid: 0,
};

// Listeners for UI state updates
const stateListeners: ((state: MultiplayerState) => void)[] = [];

let processingGuestTask = false;

export const isProcessingGuestTask = () => processingGuestTask;
export const setProcessingGuestTask = (val: boolean) => {
  processingGuestTask = val;
};

export const syncUserTidsToWorker = async () => {
  if (state.role === "host") {
    try {
      const userTids = [state.hostTid, state.guestTid];
      await promiseWorker.postMessage(["main", "updateGameAttributes", { 
        userTids 
      }]);
    } catch (err) {
      console.error("Failed to sync userTids to worker:", err);
    }
  }
};

export const restoreUserTidsOnDisconnect = async () => {
  try {
    await promiseWorker.postMessage(["main", "updateGameAttributes", { 
      userTids: [state.hostTid] 
    }]);
  } catch (err) {
    console.error("Failed to restore userTids on disconnect:", err);
  }
};

export const getMultiplayerState = () => ({ ...state });

export const subscribeMultiplayerState = (listener: (state: MultiplayerState) => void) => {
  stateListeners.push(listener);
  listener({ ...state });
  return () => {
    const index = stateListeners.indexOf(listener);
    if (index >= 0) stateListeners.splice(index, 1);
  };
};

const updateState = (updates: Partial<MultiplayerState>) => {
  state = { ...state, ...updates };
  stateListeners.forEach((l) => l({ ...state }));
};

export const updateMultiplayerWorkerTid = (tid: number) => {
  updateState({ currentWorkerTid: tid });
};

// Store active pending promises for guests calling toWorker
const pendingCallbacks = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();

export const updateHostTid = (tid: number) => {
  if (state.role === "host" && state.hostTid !== tid) {
    updateState({ hostTid: tid });
    socket?.emit("host-tid-change", { tid });
    syncUserTidsToWorker();
  }
};

export const updateGuestTid = (tid: number) => {
  if (state.role === "guest" && state.guestTid !== tid) {
    updateState({ guestTid: tid });
    socket?.emit("guest-tid-change", { tid });
  }
};

export const updateHostLid = (lid: number) => {
  if (state.role === "host" && state.lid !== lid) {
    updateState({ lid });
    socket?.emit("host-lid-change", { lid });
  }
};

// Initiate simulation on Host's local Web Worker
const executeHostSimulation = async (option: string) => {
  enqueueWorkerTask(async () => {
    try {
      updateState({ statusMessage: `Simulating ${option}...` });
      // Call the original PlayMenu worker endpoint to simulate
      await promiseWorker.postMessage(["playMenu", option, undefined]);
      
      // Broadcast complete to everyone and reset ready states
      updateState({ hostReady: false, guestReady: false, advanceOption: null, statusMessage: "Simulation complete." });
      socket?.emit("simulation-complete");
    } catch (err) {
      console.error("Simulation failed:", err);
      updateState({ hostReady: false, guestReady: false, advanceOption: null, statusMessage: "Simulation failed!" });
      socket?.emit("simulation-complete");
    }
  });
};

// Trigger simulation ready or cancel coordination
export const setPlayerReadyToAdvance = (ready: boolean, option: string | null = null) => {
  if (!state.isMultiplayer) return;

  const resolvedOption = option || state.advanceOption;
  if (ready && !resolvedOption) return;

  if (state.role === "host") {
    updateState({ hostReady: ready, advanceOption: ready ? resolvedOption : null });
    socket?.emit("player-ready-to-advance", { ready, option: ready ? resolvedOption : null });

    // Host checking if both are ready
    if (ready && state.guestReady && resolvedOption) {
      executeHostSimulation(resolvedOption);
    }
  } else if (state.role === "guest") {
    updateState({ guestReady: ready, advanceOption: ready ? resolvedOption : null });
    socket?.emit("player-ready-to-advance", { ready, option: ready ? resolvedOption : null });

    // Guest telling Host to start the simulation if both are ready
    if (ready && state.hostReady && resolvedOption) {
      socket?.emit("guest-trigger-simulation", { option: resolvedOption });
    }
  }
};

export const initMultiplayer = (role: "host" | "guest", roomId: string) => {
  if (socket) {
    socket.disconnect();
  }

  // @ts-expect-error
  const envUrl = process.env.MULTIPLAYER_RELAY_URL;
  const serverUrl = envUrl && envUrl.trim() !== ""
    ? envUrl
    : window.location.hostname === "localhost" 
      ? "http://localhost:3001" 
      : `${window.location.protocol}//${window.location.hostname}:3001`;

  socket = io(serverUrl);

  updateState({
    isMultiplayer: true,
    role,
    roomId,
    statusMessage: "Connecting to relay server...",
    hostReady: false,
    guestReady: false,
    advanceOption: null,
  });

  socket.on("connect", () => {
    updateState({ statusMessage: "Connected to relay. Joining room..." });
    socket?.emit("join-room", { roomId, role });
  });

  socket.on("room-status", ({ success, message }) => {
    if (success) {
      updateState({ statusMessage: `Ready: ${message}` });
      if (role === "guest") {
        socket?.emit("guest-request-sync");
      }
    } else {
      updateState({ statusMessage: `Error: ${message}`, isMultiplayer: false, role: null, roomId: null });
    }
  });

  socket.on("disconnect", () => {
    updateState({ 
      statusMessage: "Disconnected from relay server.", 
      isMultiplayer: false, 
      role: null, 
      roomId: null, 
      lid: null,
      hostReady: false,
      guestReady: false,
      advanceOption: null,
    });
  });

  // Handle synchronized state changes
  socket.on("host-tid-synced", ({ tid }) => {
    updateState({ hostTid: tid });
  });

  socket.on("guest-tid-synced", ({ tid }) => {
    updateState({ guestTid: tid });
  });

  socket.on("host-lid-synced", ({ lid }) => {
    updateState({ lid });
    
    if (role === "guest" && lid !== null) {
      const isAlreadyOnCorrectLid = window.location.pathname.startsWith(`/l/${lid}`);
      if (!isAlreadyOnCorrectLid) {
        router.navigate(`/l/${lid}/`, { replace: true });
      }
    }
  });

  // Handle simulation ready updates
  socket.on("player-ready-to-advance", ({ senderRole, ready, option }) => {
    const resolvedOption = option || state.advanceOption;
    if (senderRole === "host") {
      updateState({ hostReady: ready, advanceOption: ready ? resolvedOption : null });
    } else if (senderRole === "guest") {
      updateState({ guestReady: ready, advanceOption: ready ? resolvedOption : null });
    }

    // Host checks if both players are now ready, and executes simulation if so
    if (state.role === "host" && state.hostReady && state.guestReady && resolvedOption) {
      executeHostSimulation(resolvedOption);
    }
  });

  socket.on("simulation-complete", () => {
    updateState({ hostReady: false, guestReady: false, advanceOption: null, statusMessage: "Simulation advanced successfully." });
  });

  // Handle multiplayer trade proposals
  socket.on("propose-multiplayer-trade", ({ teams }) => {
    updateState({ pendingTrade: teams });
    showNotification({
      type: "info",
      text: "Pending Trade Proposal received! Review it on your Trade screen.",
    });
  });

  socket.on("decline-multiplayer-trade", () => {
    updateState({ pendingTrade: null });
    showNotification({
      type: "error",
      text: "The other GM declined your trade proposal.",
    });
  });

  socket.on("accept-multiplayer-trade", () => {
    updateState({ pendingTrade: null });
    showNotification({
      type: "success",
      text: "The trade proposal was accepted and successfully executed!",
    });
    realtimeUpdate(["playerMovement"]);
  });

  if (role === "host") {
    // HOST LISTENERS
    
    // Sync guest triggers to run the simulation
    socket.on("guest-trigger-simulation", ({ option }) => {
      if (state.hostReady && state.guestReady) {
        executeHostSimulation(option);
      }
    });

    socket.on("guest-request-sync", () => {
      socket?.emit("host-tid-change", { tid: state.hostTid });
      socket?.emit("guest-tid-change", { tid: state.guestTid });
      if (state.lid !== null) {
        socket?.emit("host-lid-change", { lid: state.lid });
      }
    });

    socket.on("guest-tid-change", ({ tid }) => {
      updateState({ guestTid: tid });
      syncUserTidsToWorker();
    });

    // When a guest requests a worker execution
    socket.on("guest-to-worker", ({ guestId, callbackId, payload }) => {
      enqueueWorkerTask(async () => {
        try {
          setProcessingGuestTask(true);

          // Lazy Context Switch: only switch if the worker is not already on guestTid
          if (state.currentWorkerTid !== state.guestTid) {
            await promiseWorker.postMessage(["main", "setTeamContext", state.guestTid]);
            updateState({ currentWorkerTid: state.guestTid });
          }

          const result = await promiseWorker.postMessage(payload);

          setProcessingGuestTask(false);

          socket?.emit("host-to-guest-response", {
            guestId,
            callbackId,
            payload: result,
          });
        } catch (err: any) {
          setProcessingGuestTask(false);

          socket?.emit("host-to-guest-response", {
            guestId,
            callbackId,
            error: err?.message || String(err),
          });
        }
      });
    });

    socket.on("guest-joined", ({ guestId }) => {
      updateState({ statusMessage: `Guest joined (${guestId.substring(0, 5)})! Game active.` });
      socket?.emit("host-tid-change", { tid: state.hostTid });
      if (state.lid !== null) {
        socket?.emit("host-lid-change", { lid: state.lid });
      }
      syncUserTidsToWorker();
    });
  } else {
    // GUEST LISTENERS
    
    socket.on("host-tid-change", ({ tid }) => {
      updateState({ hostTid: tid });
    });

    // Resolve guest's pending toWorker promises when host replies
    socket.on("worker-response", ({ callbackId, payload, error }) => {
      const cb = pendingCallbacks.get(callbackId);
      if (cb) {
        pendingCallbacks.delete(callbackId);
        if (error) {
          cb.reject(new Error(error));
        } else {
          cb.resolve(payload);
        }
      }
    });

    // Execute server-to-UI pushes initiated by the Host's Worker
    socket.on("worker-broadcast", async ({ event, payload }) => {
      if (Object.hasOwn(api, event)) {
        try {
          if (event === "setGameAttributes") {
            const [gameAttributes] = payload;
            if (gameAttributes && typeof gameAttributes === "object") {
              const { userTid, userTids, ...restAttributes } = gameAttributes;
              payload[0] = restAttributes;
            }
          }
          // @ts-expect-error
          await api[event](...payload);
        } catch (err) {
          console.error(`Error running broadcast event ${event}:`, err);
        }
      } else {
        console.warn(`Received unregistered broadcast event: ${event}`);
      }
    });

    socket.on("host-disconnected", () => {
      updateState({ 
        statusMessage: "Host disconnected. Game ended.", 
        isMultiplayer: false, 
        role: null, 
        roomId: null, 
        lid: null,
        hostReady: false,
        guestReady: false,
        advanceOption: null,
      });
    });
  }
};

export const leaveMultiplayer = () => {
  const oldRole = state.role;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  updateState({
    isMultiplayer: false,
    role: null,
    roomId: null,
    statusMessage: "Disconnected",
    lid: null,
    hostReady: false,
    guestReady: false,
    advanceOption: null,
  });

  if (oldRole === "host") {
    restoreUserTidsOnDisconnect();
  }
};

// Send guest message to host via Socket.io
export const toWorkerGuest = (payload: any): Promise<any> => {
  const [type, name, param] = payload;

  if (type === "main") {
    if (name === "updateMultiTeamMode") {
      return Promise.resolve(undefined);
    }
    if (name === "updateGameAttributes" && param && typeof param === "object") {
      const { userTid, userTids, ...rest } = param;
      if (Object.keys(rest).length === 0) {
        return Promise.resolve(undefined);
      }
      payload[2] = rest;
    }
  }

  return new Promise((resolve, reject) => {
    if (!socket || !state.isMultiplayer || state.role !== "guest") {
      reject(new Error("Not connected to a multiplayer room as Guest."));
      return;
    }

    const callbackId = Math.random().toString(36).substring(2, 15);
    pendingCallbacks.set(callbackId, { resolve, reject });

    socket.emit("guest-to-worker", {
      callbackId,
      payload,
    });
  });
};

// Broadcast local Host Worker -> Host UI calls to all Guests
export const broadcastHostUI = (name: string, params: any[]) => {
  if (socket && state.isMultiplayer && state.role === "host") {
    // If we are NOT processing a Guest's task, then this UI push is specific to the Host's local actions.
    // We should ONLY broadcast global/shared events, and SKIP broadcasting Host-team-specific UI state to the Guest.
    if (!processingGuestTask) {
      const globalEvents = [
        "realtimeUpdate",
        "showNotification",
        "showModal",
        "autoPlayDialog",
      ];
      if (!globalEvents.includes(name)) {
        return;
      }
    }

    socket.emit("host-broadcast", {
      event: name,
      payload: params,
    });
  }
};

export const proposeMultiplayerTrade = (teams: TradeTeams) => {
  if (socket && state.isMultiplayer) {
    socket.emit("propose-multiplayer-trade", { teams });
  }
};

export const declineMultiplayerTrade = () => {
  const trade = state.pendingTrade;
  if (trade) {
    socket?.emit("decline-multiplayer-trade");
    updateState({ pendingTrade: null });
  }
};

export const acceptMultiplayerTrade = async () => {
  const trade = state.pendingTrade;
  if (trade) {
    try {
      const result = await toWorker("main", "proposeTrade", {
        forceTrade: false,
        isMultiplayerAccept: true,
      });

      const accepted = result?.accepted;
      const message = result?.message;

      if (accepted) {
        socket?.emit("accept-multiplayer-trade");
        updateState({ pendingTrade: null });
        showNotification({
          type: "success",
          text: "Trade successfully executed!",
        });
      } else if (message) {
        showNotification({
          type: "error",
          text: message,
        });
      }
    } catch (err: any) {
      showNotification({
        type: "error",
        text: `Failed to execute trade: ${err?.message || String(err)}`,
      });
    }
  }
};
