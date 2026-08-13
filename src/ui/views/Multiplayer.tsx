import { useState, useEffect } from "react";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { useLocal, localActions } from "../util/local.ts";
import { 
  initMultiplayer, 
  leaveMultiplayer, 
  subscribeMultiplayerState, 
  updateHostTid,
  updateGuestTid,
  updateHostLid
} from "../util/multiplayer.ts";
import type { MultiplayerState } from "../util/multiplayer.ts";

const Multiplayer = () => {
  useTitleBar({ title: "Multiplayer Lobby" });

  const { teamInfoCache, userTid, lid } = useLocal(["teamInfoCache", "userTid", "lid"]);

  const [mState, setMState] = useState<MultiplayerState>({
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
  });

  const [inputRoomId, setInputRoomId] = useState("");
  const [generatedRoomId, setGeneratedRoomId] = useState("");

  useEffect(() => {
    // Subscribe to multiplayer state updates
    const unsubscribe = subscribeMultiplayerState((newState) => {
      setMState(newState);

      // Symmetrically update Guest local UI userTid on state sync (e.g. initial connection)
      if (newState.isMultiplayer && newState.role === "guest") {
        if (userTid !== newState.guestTid) {
          localActions.update({ userTid: newState.guestTid });
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Keep Host's multiplayer hostTid and active lid in sync with their active dropdown userTid
  useEffect(() => {
    if (mState.isMultiplayer && mState.role === "host") {
      updateHostTid(userTid);
      if (lid !== undefined && lid !== null && mState.lid !== lid) {
        updateHostLid(lid);
      }
    }
  }, [userTid, lid, mState.isMultiplayer, mState.role, mState.lid]);

  // Keep Guest's multiplayer guestTid in sync with their active dropdown userTid
  useEffect(() => {
    if (mState.isMultiplayer && mState.role === "guest") {
      updateGuestTid(userTid);
    }
  }, [userTid, mState.isMultiplayer, mState.role]);

  const handleHost = () => {
    const code = "LOBBY-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    setGeneratedRoomId(code);
    initMultiplayer("host", code);
  };

  const handleJoin = () => {
    if (!inputRoomId.trim()) return;
    initMultiplayer("guest", inputRoomId.trim().toUpperCase());
  };

  const handleDisconnect = () => {
    leaveMultiplayer();
  };

  const handleHostTeamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const tid = Number(e.target.value);
    updateHostTid(tid);
    if (userTid !== tid) {
      localActions.update({ userTid: tid });
    }
  };

  const handleGuestTeamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const tid = Number(e.target.value);
    updateGuestTid(tid);
    localActions.update({ userTid: tid });
  };

  const hasLeagueActive = teamInfoCache && teamInfoCache.length > 0;

  return (
    <div>
      <h2>Multiplayer Lobby (Beta)</h2>
      <p className="lead">
        Play Basketball GM in real-time with another player! One player acts as the <b>Host</b> (who runs the game engine and simulation), and the other acts as the <b>Guest</b>.
      </p>

      <div className="card mb-4">
        <div className="card-body">
          <h4 className="card-title">Connection Status</h4>
          <p className="card-text fs-5">
            <strong>Current State: </strong> 
            {mState.isMultiplayer ? (
              <span className="badge bg-success">Active ({mState.role === "host" ? "Host" : "Guest"})</span>
            ) : (
              <span className="badge bg-secondary">Solo Mode</span>
            )}
          </p>
          <p className="card-text text-muted">{mState.statusMessage}</p>
          {mState.isMultiplayer && (
            <div className="d-flex gap-2">
              {mState.lid !== null && (
                <a href={`/l/${mState.lid}`} className="btn btn-primary">
                  Go to League Dashboard
                </a>
              )}
              <button className="btn btn-danger" onClick={handleDisconnect}>
                Disconnect & Return to Solo Mode
              </button>
            </div>
          )}
        </div>
      </div>

      {!mState.isMultiplayer && (
        <div className="row">
          <div className="col-md-6 mb-3">
            <div className="card h-100">
              <div className="card-body d-flex flex-column justify-content-between">
                <div>
                  <h4 className="card-title text-primary">Host a Game</h4>
                  <p className="card-text">
                    Become the host of this league. Your local browser will act as the simulation engine and the source of truth database. You can invite a guest to play with you simultaneously.
                  </p>
                </div>
                <div className="mt-3">
                  <button className="btn btn-primary btn-lg w-100" onClick={handleHost}>
                    Host League
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="col-md-6 mb-3">
            <div className="card h-100">
              <div className="card-body d-flex flex-column justify-content-between">
                <div>
                  <h4 className="card-title text-success">Join a Hosted Game</h4>
                  <p className="card-text">
                    Enter your friend's Invite/Room ID below to connect directly to their league as a Guest player. You'll see updates on your screen in real-time as games are simulated.
                  </p>
                  <div className="mb-3">
                    <input
                      type="text"
                      className="form-control form-control-lg text-uppercase"
                      placeholder="Enter Room ID (e.g., LOBBY-ABCDEF)"
                      value={inputRoomId}
                      onChange={(e) => setInputRoomId(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <button 
                    className="btn btn-success btn-lg w-100" 
                    onClick={handleJoin}
                    disabled={!inputRoomId.trim()}
                  >
                    Join League
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mState.isMultiplayer && (
        <div className="row">
          <div className="col-md-6 mb-3">
            <div className="card">
              <div className="card-body">
                <h4 className="card-title">Team Control Assignments</h4>
                <p className="card-text text-muted">
                  Assign which team each player manages in this league.
                </p>

                {hasLeagueActive ? (
                  <form>
                    <div className="mb-3">
                      <label className="form-label"><b>Host (Player 1) Team:</b></label>
                      <select 
                        className="form-select" 
                        value={mState.hostTid} 
                        onChange={handleHostTeamChange}
                        disabled={mState.role !== "host"}
                      >
                        {teamInfoCache.map((team, idx) => (
                          <option key={idx} value={idx}>
                            {team.region} {team.name} ({team.abbrev})
                          </option>
                        ))}
                      </select>
                      {mState.role === "guest" && (
                        <div className="form-text">Only the host can modify this.</div>
                      )}
                    </div>

                    <div className="mb-3">
                      <label className="form-label"><b>Guest (Player 2) Team:</b></label>
                      <select 
                        className="form-select" 
                        value={mState.guestTid} 
                        onChange={handleGuestTeamChange}
                        disabled={mState.role !== "guest"}
                      >
                        {teamInfoCache.map((team, idx) => (
                          <option key={idx} value={idx}>
                            {team.region} {team.name} ({team.abbrev})
                          </option>
                        ))}
                      </select>
                      {mState.role === "host" && (
                        <div className="form-text">Only the guest can modify this.</div>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className="alert alert-warning mb-0">
                    Please open or create a league to select team control assignments.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="col-md-6 mb-3">
            {mState.role === "host" ? (
              <div className="alert alert-info">
                <h4 className="alert-heading">You are Hosting!</h4>
                <p>
                  Share this Invite Room ID with your friend so they can join your league:
                </p>
                <h3 className="text-center font-monospace bg-light p-3 border rounded text-dark tracking-widest">
                  {mState.roomId || generatedRoomId}
                </h3>
                <p className="mb-0 mt-3 text-muted">
                  Note: Keep this browser tab open. If you close it or disconnect, your friend will be disconnected.
                </p>
              </div>
            ) : (
              <div className="alert alert-success">
                <h4 className="alert-heading">You are Joined as Guest!</h4>
                <p>
                  Successfully connected to Host Room: <strong>{mState.roomId}</strong>
                </p>
                <p className="mb-0">
                  You are viewing the host's league state. Any actions you take (like signing free agents or drafting) will be sent to the host's machine to process.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Multiplayer;
