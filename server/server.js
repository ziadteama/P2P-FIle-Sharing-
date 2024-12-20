import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const peerIds = {}; // Store peerId for each socket connection

// Simple route to check server status
app.get('/', (req, res) => {
    res.send('Signaling Server Running');
});

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log('A peer connected:', socket.id);

    // Store the peerId for this socket connection
    socket.on('setPeerId', (peerId) => {
        if (!peerId) {
            console.error('Peer ID is missing');
            return;
        }
        peerIds[socket.id] = peerId; // Save the peerId corresponding to the socket id
        console.log(`Peer ID set for socket ${socket.id}: ${peerId}`);
        console.log('Current peer IDs:', peerIds); // Log all connected peer IDs
    });

    // Listen for incoming signaling messages
    socket.on('signal', (data) => {
        const { target, signal } = data;
        const senderPeerId = peerIds[socket.id]; // Get the peerId of the sender

        if (!senderPeerId) {
            console.error('Sender peer ID not found for socket:', socket.id);
            return;
        }

        if (!target || !signal) {
            console.error('Invalid signal data received. Target or signal is missing.');
            return;
        }

        console.log(`Forwarding signal from peer ${senderPeerId} (socket: ${socket.id}) to target ${target}`);

        // Find the socket ID of the target peer
        const targetSocketId = Object.keys(peerIds).find(id => peerIds[id] === target);

        if (targetSocketId) {
            console.log(`Target peer ${target} is connected. Forwarding signal...`);
            // Emit the signal to the target peer
            io.to(targetSocketId).emit('signal', { sender: senderPeerId, signal });
        } else {
            console.log(`Target peer ${target} is not connected.`);
            // Log the current state of peer IDs for debugging
            console.log('Currently connected peers:', peerIds);
        }
    });

    // Listen for peer disconnections
    socket.on('disconnect', () => {
        const disconnectedPeerId = peerIds[socket.id];
        console.log(`A peer disconnected: ${disconnectedPeerId} (socket: ${socket.id})`);
        
        // Remove the peerId associated with this socket
        delete peerIds[socket.id];

        console.log('Updated peer IDs after disconnect:', peerIds);
    });
});

// Set the port for the server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Signaling server running on http://localhost:${PORT}`);
});
