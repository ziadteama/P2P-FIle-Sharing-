import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

const FileShare = () => {
    const [peerId, setPeerId] = useState('');
    const [connectedPeerId, setConnectedPeerId] = useState('');
    const [file, setFile] = useState(null);
    const [connectionStatus, setConnectionStatus] = useState('Not connected');
    const [receivedFiles, setReceivedFiles] = useState([]);
    const socket = useRef(null);
    const peerConnection = useRef(null);
    const dataChannel = useRef(null);
    const fileChunks = useRef([]);
    const totalChunksRef = useRef(0);
    const [sendingInProgress, setSendingInProgress] = useState(false);

    useEffect(() => {
        const uniqueId = uuidv4();
        setPeerId(uniqueId);
        socket.current = io('http://localhost:3000');

        console.log(`[DEBUG] Your Peer ID: ${uniqueId}`);
        socket.current.emit('setPeerId', uniqueId);

        socket.current.on('signal', async ({ sender, signal }) => {
            console.log(`[DEBUG] Received signal from ${sender}`, signal);

            if (signal.type === 'offer') {
                console.log(`[DEBUG] Handling offer from ${sender}`);
                try {
                    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
                    const answer = await peerConnection.current.createAnswer();
                    await peerConnection.current.setLocalDescription(answer);
                    console.log(`[DEBUG] Sending answer to ${sender}`);
                    socket.current.emit('signal', { target: sender, signal: answer });
                } catch (err) {
                    console.error(`[ERROR] Error handling offer: ${err}`);
                }
            } else if (signal.type === 'answer') {
                console.log(`[DEBUG] Handling answer from ${sender}`);
                try {
                    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
                } catch (err) {
                    console.error(`[ERROR] Error handling answer: ${err}`);
                }
            } else if (signal.candidate) {
                console.log(`[DEBUG] Handling ICE candidate from ${sender}`);
                try {
                    await peerConnection.current.addIceCandidate(new RTCIceCandidate(signal));
                } catch (err) {
                    console.error(`[ERROR] Error adding ICE candidate: ${err}`);
                }
            }
        });

        return () => {
            socket.current.disconnect();
            console.log('[DEBUG] Socket disconnected');
        };
    }, []);

    const connectToPeer = async () => {
        console.log(`[DEBUG] Attempting to connect to peer: ${connectedPeerId}`);
        if (!peerConnection.current) {
            setConnectionStatus('Connecting...');
            peerConnection.current = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });

            dataChannel.current = peerConnection.current.createDataChannel('fileTransfer', { negotiated: true, id: 0 });
            console.log('[DEBUG] Data channel created', dataChannel.current);

            dataChannel.current.onopen = () => {
                console.log('[DEBUG] Data channel opened');
                setConnectionStatus('Connected');
            };
            dataChannel.current.onclose = () => {
                console.log('[DEBUG] Data channel closed');
                setConnectionStatus('Disconnected');
            };
            dataChannel.current.onmessage = (event) => {
                console.log('[DEBUG] Data channel received message');
                if (typeof event.data === 'string') {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'totalChunks') {
                            totalChunksRef.current = message.totalChunks;
                            console.log(`[DEBUG] Total chunks to receive: ${message.totalChunks}`);
                        }
                    } catch (error) {
                        console.error('[ERROR] Error parsing JSON message:', error);
                    }
                } else {
                    fileChunks.current.push(event.data);
                    console.log(`[DEBUG] Chunk received (${fileChunks.current.length}/${totalChunksRef.current})`);
                    if (fileChunks.current.length === totalChunksRef.current) {
                        const fileBlob = new Blob(fileChunks.current);
                        const downloadUrl = URL.createObjectURL(fileBlob);
                        const fileName = `received-file-${Date.now()}.pdf`;
                        setReceivedFiles((prevFiles) => [
                            ...prevFiles,
                            { url: downloadUrl, name: fileName },
                        ]);
                        console.log('[DEBUG] File reconstructed and download link created');
                        fileChunks.current = []; // Clear chunks after file is reconstructed
                    }
                }
            };

            peerConnection.current.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('[DEBUG] Sending ICE candidate');
                    socket.current.emit('signal', {
                        target: connectedPeerId,
                        signal: event.candidate,
                    });
                }
            };

            try {
                const offer = await peerConnection.current.createOffer();
                await peerConnection.current.setLocalDescription(offer);
                console.log('[DEBUG] Sending offer to peer');
                socket.current.emit('signal', { target: connectedPeerId, signal: offer });
            } catch (err) {
                console.error('[ERROR] Error creating offer:', err);
            }
        }
    };

    const handleFileChange = (event) => {
        setFile(event.target.files[0]);
        console.log('[DEBUG] Selected file:', event.target.files[0]);
    };

    const sendFile = () => {
        if (file && dataChannel.current && dataChannel.current.readyState === 'open') {
            const chunkSize = 16384; // 16 KB per chunk
            const reader = new FileReader();
            let offset = 0;

            setSendingInProgress(true);
            const totalChunks = Math.ceil(file.size / chunkSize);
            totalChunksRef.current = totalChunks;

            console.log(`[DEBUG] Total chunks to send: ${totalChunks}`);
            dataChannel.current.send(JSON.stringify({ type: 'totalChunks', totalChunks }));

            const readNextChunk = () => {
                const chunk = file.slice(offset, offset + chunkSize);
                reader.readAsArrayBuffer(chunk);
            };

            reader.onload = () => {
                dataChannel.current.send(reader.result);
                console.log(`[DEBUG] Sent chunk (${offset}/${file.size})`);
                offset += chunkSize;
                if (offset < file.size) {
                    readNextChunk();
                } else {
                    console.log('[DEBUG] File transmission completed');
                    setSendingInProgress(false);
                }
            };

            reader.onerror = (err) => {
                console.error('[ERROR] Error reading file:', err);
                setSendingInProgress(false);
            };

            readNextChunk();
        } else {
            console.error('[ERROR] Data channel not open or file not selected');
        }
    };

    return (
        <div>
            <h1>P2P File Sharing</h1>
            <p>Your Peer ID: {peerId}</p>
            <p>Status: {connectionStatus}</p>

            <input
                type="text"
                placeholder="Enter Peer ID to connect"
                value={connectedPeerId}
                onChange={(e) => setConnectedPeerId(e.target.value)}
            />
            <button onClick={connectToPeer}>Connect</button>

            <input type="file" onChange={handleFileChange} />
            <button onClick={sendFile} disabled={!file || sendingInProgress || !dataChannel.current || dataChannel.current.readyState !== 'open'}>
                {sendingInProgress ? 'Sending...' : 'Send File'}
            </button>

            {receivedFiles.length === 0 ? (
                <p>No files transmitted yet</p>
            ) : (
                <div>
                    <h2>Received Files:</h2>
                    {receivedFiles.map((file, index) => (
                        <div key={index}>
                            <a href={file.url} download={file.name}>
                                {file.name}
                            </a>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FileShare;
