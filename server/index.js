import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle joining/creating rooms
  socket.on("join-room", ({ roomId, role }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = role;

    if (role === "host") {
      rooms.set(roomId, socket.id);
      console.log(`Room ${roomId} created with host ${socket.id}`);
      socket.emit("room-status", { success: true, message: "Host registered successfully." });
    } else {
      const hostId = rooms.get(roomId);
      if (!hostId) {
        socket.emit("room-status", { success: false, message: "Room does not exist or has no active host." });
        console.log(`Guest ${socket.id} tried to join non-existent room ${roomId}`);
      } else {
        console.log(`Guest ${socket.id} joined room ${roomId}`);
        socket.emit("room-status", { success: true, message: "Joined room successfully." });
        io.to(hostId).emit("guest-joined", { guestId: socket.id });
      }
    }
  });

  // Relay Host team ID changes to Guests in the room
  socket.on("host-tid-change", ({ tid }) => {
    const roomId = socket.roomId;
    if (roomId && socket.role === "host") {
      socket.to(roomId).emit("host-tid-synced", { tid });
    }
  });

  // Relay Guest team ID changes to Host
  socket.on("guest-tid-change", ({ tid }) => {
    const roomId = socket.roomId;
    if (roomId) {
      const hostId = rooms.get(roomId);
      if (hostId) {
        io.to(hostId).emit("guest-tid-synced", { tid });
      }
    }
  });

  // Relay Host league ID changes to Guests in the room
  socket.on("host-lid-change", ({ lid }) => {
    const roomId = socket.roomId;
    if (roomId && socket.role === "host") {
      socket.to(roomId).emit("host-lid-synced", { lid });
    }
  });

  // Relay Guest state request to Host
  socket.on("guest-request-sync", () => {
    const roomId = socket.roomId;
    if (roomId) {
      const hostId = rooms.get(roomId);
      if (hostId) {
        io.to(hostId).emit("guest-request-sync");
      }
    }
  });

  // Relay simulation ready/sync state between players
  socket.on("player-ready-to-advance", ({ ready, option }) => {
    const roomId = socket.roomId;
    if (roomId) {
      socket.to(roomId).emit("player-ready-to-advance", {
        senderRole: socket.role,
        ready,
        option
      });
    }
  });

  // Relay Guest trigger to simulate back to Host
  socket.on("guest-trigger-simulation", ({ option }) => {
    const roomId = socket.roomId;
    if (roomId) {
      const hostId = rooms.get(roomId);
      if (hostId) {
        io.to(hostId).emit("guest-trigger-simulation", { option });
      }
    }
  });

  // Relay simulation complete signal from Host to Guest
  socket.on("simulation-complete", () => {
    const roomId = socket.roomId;
    if (roomId && socket.role === "host") {
      socket.to(roomId).emit("simulation-complete");
    }
  });

  // Relay guest message to Host
  socket.on("guest-to-worker", ({ callbackId, payload }) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const hostId = rooms.get(roomId);
    if (hostId) {
      io.to(hostId).emit("guest-to-worker", {
        guestId: socket.id,
        callbackId,
        payload
      });
    } else {
      socket.emit("worker-response", {
        callbackId,
        error: "Host disconnected"
      });
    }
  });

  // Relay host response back to Guest
  socket.on("host-to-guest-response", ({ guestId, callbackId, payload, error }) => {
    io.to(guestId).emit("worker-response", {
      callbackId,
      payload,
      error
    });
  });

  // Broadcast host-initiated events (like progress bar, real-time updates) to all guests
  socket.on("host-broadcast", ({ event, payload }) => {
    const roomId = socket.roomId;
    if (roomId && socket.role === "host") {
      socket.to(roomId).emit("worker-broadcast", { event, payload });
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (socket.role === "host" && socket.roomId) {
      rooms.delete(socket.roomId);
      io.to(socket.roomId).emit("host-disconnected");
      console.log(`Host left, room ${socket.roomId} disbanded.`);
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`WebSocket relay server is running on port ${PORT}`);
});
