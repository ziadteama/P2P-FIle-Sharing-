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
    const [totalChunks, setTotalChunks] = useState();
    const [sendingInProgress, setSendingInProgress] = useState(false);

    useEffect(() => {
        const uniqueId = uuidv4();
        setPeerId(uniqueId);
        socket.current = io('http://localhost:3000');

        console.log('Connecting to signaling server with peerId:', uniqueId);
        socket.current.emit('setPeerId', uniqueId);

        socket.current.on('signal', async ({ sender, signal }) => {
            console.log('Received signal from:', sender, 'Signal:', signal);

            if (signal.type === 'offer') {
                console.log('Received offer from:', sender);
                try {
                    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
                    const answer = await peerConnection.current.createAnswer();
                    await peerConnection.current.setLocalDescription(answer);
                    console.log('Sending answer to:', sender);
                    socket.current.emit('signal', {
                        target: sender,
                        signal: answer,
                    });
                } catch (err) {
                    console.error('Error handling offer:', err);
                }
            } else if (signal.type === 'answer') {
                console.log('Received answer from:', sender);
                try {
                    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
                } catch (err) {
                    console.error('Error handling answer:', err);
                }
            } else if (signal.candidate) {
                console.log('Received ICE candidate from:', sender);
                try {
                    await peerConnection.current.addIceCandidate(new RTCIceCandidate(signal));
                } catch (err) {
                    console.error('Error adding ICE candidate:', err);
                }
            }
        });

        return () => {
            socket.current.disconnect();
            console.log('Socket disconnected');
        };
    }, []);

    useEffect(() => {
        console.log(`Total chunks updated: ${totalChunks}`);
    }, [totalChunks]); // This will run every time totalChunks changes

    const connectToPeer = async () => {
        if (!peerConnection.current) {
            console.log('Connecting to peer:', connectedPeerId);
            setConnectionStatus('Connecting...');
            peerConnection.current = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            });

            dataChannel.current = peerConnection.current.createDataChannel('fileTransfer', { negotiated: true, id: 0 });
            console.log('Data channel created:', dataChannel.current);

            dataChannel.current.onopen = () => {
                console.log('Data channel opened');
                setConnectionStatus('Connected');
            };
            dataChannel.current.onclose = () => {
                console.log('Data channel closed');
                setConnectionStatus('Disconnected');
            };
            dataChannel.current.onmessage = (event) => {
                console.log('Received message through data channel');
                // Check if the message is JSON
                try {
                    const message = JSON.parse(event.data);
                    console.log('Received JSON message:', message);
                    console.log("Received message total chunks:", message.totalChunks);

                    if (message.type === 'totalChunks') {
                        setTotalChunks(message.totalChunks);
                    } else {
                        console.error('Unexpected JSON message type:', message);
                    }
                } catch (error) {
                    // Not JSON, treat it as file data (ArrayBuffer)
                    console.log('Received file data (ArrayBuffer)');
                    fileChunks.current.push(event.data);
                    console.log('Current fileChunks length:', fileChunks.current.length);

                    if (fileChunks.current.length === totalChunks) {
                        const fileBlob = new Blob(fileChunks.current);  // Create a Blob from the chunks
                        const downloadUrl = URL.createObjectURL(fileBlob);

                        // Update the state to trigger re-render
                        setReceivedFiles(prevFiles => [
                            ...prevFiles,
                            { url: downloadUrl, name: `received-file-${Date.now()}` }
                        ]);

                        console.log('File received and download URL set');
                    }
                }
            };

            peerConnection.current.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('Sending ICE candidate to:', connectedPeerId);
                    socket.current.emit('signal', {
                        target: connectedPeerId,
                        signal: event.candidate,
                    });
                } else {
                    console.log('All ICE candidates sent');
                }
            };

            peerConnection.current.oniceconnectionstatechange = () => {
                console.log('ICE connection state changed:', peerConnection.current.iceConnectionState);
                if (peerConnection.current.iceConnectionState === 'connected') {
                    setConnectionStatus('Connected');
                } else if (peerConnection.current.iceConnectionState === 'disconnected') {
                    setConnectionStatus('Disconnected');
                }
            };

            try {
                const offer = await peerConnection.current.createOffer();
                await peerConnection.current.setLocalDescription(offer);
                console.log('Sending offer to:', connectedPeerId);

                socket.current.emit('signal', {
                    target: connectedPeerId,
                    signal: offer,
                });
            } catch (err) {
                console.error('Error creating offer:', err);
            }
        } else {
            console.log('Already connected to another peer.');
        }
    };

    const handleFileChange = (event) => {
        setFile(event.target.files[0]);
    };

    const sendFile = () => {
        if (file && dataChannel.current && dataChannel.current.readyState === 'open') {
            const chunkSize = 16384;  // 16 KB per chunk
            const reader = new FileReader();
            let offset = 0;

            setSendingInProgress(true);

            // Set totalChunks before starting transmission
            const totalChunks = Math.ceil(file.size / chunkSize);
            console.log(`Total chunks: ${totalChunks}`);

            // Send the totalChunks information as the first message
            dataChannel.current.send(JSON.stringify({ type: 'totalChunks', totalChunks }));

            const readNextChunk = () => {
                const chunk = file.slice(offset, offset + chunkSize);
                reader.readAsArrayBuffer(chunk);
            };

            reader.onload = () => {
                dataChannel.current.send(reader.result);  // Send the chunk as an ArrayBuffer
                console.log(`Sent chunk: ${offset} to ${offset + chunkSize}`);

                offset += chunkSize;

                if (offset < file.size) {
                    readNextChunk();
                } else {
                    console.log('File transmission complete.' + "\n" + "Current fileChunks length: " + fileChunks.current.length);
                    setSendingInProgress(false);
                }
            };

            reader.onerror = (err) => {
                console.error('Error reading file:', err);
                setSendingInProgress(false);
            };

            dataChannel.current.onbufferedamountlow = () => {
                if (offset < file.size) {
                    readNextChunk();
                }
            };

            // Start the transmission
            readNextChunk();
        } else {
            alert('Data channel is not open or file is not selected');
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

            {/* Display received files */}
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
