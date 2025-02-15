import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";

const VideoConference = ({ userId }: { userId: string }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [peers, setPeers] = useState(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const navigate = useNavigate();
  const { roomId } = useParams();
  const peerConnections = useRef(new Map());
  const connectionsInProgress = useRef(new Set());
  const screenTrackRef = useRef<HTMLVideoElement | null>(null);
  const [screenSharing, setScreenSharing] = useState<boolean>(false);

  useEffect(() => {
    const newSocket = io("https://3eba-124-253-101-212.ngrok-free.app", {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
      withCredentials: true,
    });
    setSocket(newSocket);

    let activeStream: MediaStream | null = null; // Store the active stream to avoid race conditions

    const getMedia = async () => {
      try {
        // Try video + audio first
        activeStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      } catch (videoError) {
        console.warn(
          "⚠️ Video not available, switching to audio-only:",
          videoError
        );
        try {
          activeStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true,
          });
        } catch (audioError) {
          console.error(
            "🚨 No media devices available (even audio):",
            audioError
          );
          activeStream = null; // No media available
        }
      }

      if (activeStream) {
        setLocalStream(activeStream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = activeStream;
        }
      }
    };

    getMedia();

    return () => {
      cleanupConnections();
      activeStream?.getTracks().forEach((track) => track.stop());
      newSocket.disconnect();
    };
  }, []);


  const cleanupConnections = () => {
    peerConnections.current.forEach((pc) => {
      pc.close();
    });
    peerConnections.current.clear();
    connectionsInProgress.current.clear();
    setPeers(new Map());
  };

  useEffect(() => {
    if (!socket || !localStream) return;

    socket.emit("join", { room_id: roomId, user_id: userId });

    socket.on("user_joined", async ({ userId: newUserId }) => {
      // Prevent duplicate connections
      if (
        peerConnections.current.has(newUserId) ||
        connectionsInProgress.current.has(newUserId)
      ) {
        return;
      }

      console.log("User joined:", newUserId);
      connectionsInProgress.current.add(newUserId);

      try {
        const pc = await createPeerConnection(newUserId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("offer", {
          room_id: roomId,
          user_id: userId,
          target_user_id: newUserId,
          sdp: offer,
        });
      } catch (err) {
        console.error("Error creating offer:", err);
        connectionsInProgress.current.delete(newUserId);
      }
    });

    socket.on("offer", async (data) => {
      if (
        peerConnections.current.has(data.user_id) ||
        connectionsInProgress.current.has(data.user_id)
      ) {
        return;
      }

      try {
        connectionsInProgress.current.add(data.user_id);
        const pc = await createPeerConnection(data.user_id);
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("answer", {
          room_id: roomId,
          user_id: userId,
          target_user_id: data.user_id,
          sdp: answer,
        });
      } catch (err) {
        console.error("Error handling offer:", err);
        connectionsInProgress.current.delete(data.user_id);
      }
    });

    socket.on("answer", async (data) => {
      try {
        const pc = peerConnections.current.get(data.user_id);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } catch (err) {
        console.error("Error handling answer:", err);
      } finally {
        connectionsInProgress.current.delete(data.user_id);
      }
    });

    socket.on("ice-candidate", async (data) => {
      try {
        const pc = peerConnections.current.get(data.user_id);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error("Error handling ICE candidate:", err);
      }
    });

    socket.on("user_left", ({ userId: leftUserId }) => {
      cleanupPeerConnection(leftUserId);
    });

    return () => {
      socket.off("user_joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("user_left");
    };
  }, [socket, localStream, roomId, userId]);

  const cleanupPeerConnection = (peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
      connectionsInProgress.current.delete(peerId);
      setPeers((prev) => {
        const newPeers = new Map(prev);
        newPeers.delete(peerId);
        return newPeers;
      });
    }
  };

  const createPeerConnection = async (peerId: string) => {
    // Clean up any existing connection first
    cleanupPeerConnection(peerId);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      iceCandidatePoolSize: 10,
    });

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanupPeerConnection(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "failed" ||
        pc.iceConnectionState === "closed"
      ) {
        cleanupPeerConnection(peerId);
      }
    };

    localStream?.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit("ice-candidate", {
          room_id: roomId,
          user_id: userId,
          target_user_id: peerId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      setPeers((prev) => {
        const newPeers = new Map(prev);
        newPeers.set(peerId, event.streams[0]);
        return newPeers;
      });
    };

    peerConnections.current.set(peerId, pc);
    return pc;
  };

  // Rest of the component remains the same...
  // (keeping the toggleAudio, toggleVideo, and render methods unchanged)
  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const disconnectCall = () => {
    socket?.emit("disconnect_call", { room_id: roomId, user_id: userId });
    cleanupConnections();
    localStream?.getTracks().forEach((track) => track.stop());
    socket?.disconnect();
    navigate("/");
  };

  const toggleScreenSharing = async () => {
    if (!screenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });

        const combinedStream = new MediaStream();

        // Add audio tracks if available
        if (localStream) {
          localStream
            .getAudioTracks()
            .forEach((track) => combinedStream.addTrack(track));
        }

        screenStream
          .getVideoTracks()
          .forEach((track) => combinedStream.addTrack(track));

        screenTrackRef.current = screenStream.getVideoTracks()[0];

        peerConnections.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track.kind === "video");
          if (sender && screenTrackRef.current) {
            sender.replaceTrack(screenTrackRef.current);
          }
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = combinedStream;
        }
        if (!screenTrackRef.current) return
        screenTrackRef.current.onended = () => stopScreenSharing();
        setScreenSharing(true);
      } catch (err) {
        console.error("Error starting screen share:", err);
      }
    } else {
      stopScreenSharing();
    }
  };

  const stopScreenSharing = () => {
    if (screenTrackRef.current) {
      screenTrackRef.current.stop();
    }

    peerConnections.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track.kind === "video");
      if (sender) {
        const videoTrack = localStream?.getVideoTracks()[0]; // Handle missing video device
        sender.replaceTrack(videoTrack || null); // If no video track, replace with null
      }
    });

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream || new MediaStream();
    }

    setScreenSharing(false);
  };



  return (
    <div className="video-conference">
      <div className="video-grid">
        <div className="video-container">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="video-stream"
          />
          <div className="participant-name">You</div>
        </div>

        {Array.from(peers.entries()).map(([peerId, stream]) => (
          <div key={peerId} className="video-container">
            <video
              autoPlay
              playsInline
              className="video-stream"
              ref={(el) => {
                if (el) el.srcObject = stream;
              }}
            />
            <div className="participant-name">{peerId}</div>
          </div>
        ))}
      </div>

      <div className="controls">
        <button
          className={`control-button ${isMuted ? "disabled" : ""}`}
          onClick={toggleAudio}
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>
        <button
          className={`control-button ${isVideoOff ? "disabled" : ""}`}
          onClick={toggleVideo}
        >
          {isVideoOff ? "Start Video" : "Stop Video"}
        </button>
        <button
          className={`control-button`}
          style={{
            backgroundColor: "#bd2130",
          }}
          onClick={disconnectCall}
        >
          {"Disconnect"}
        </button>
        {<button
          className={`control-button`}
          onClick={toggleScreenSharing}
        >
          {screenSharing ? "Stop Share" : "Share Screen"}
        </button>}
      </div>

      <style jsx>{`
        .video-conference {
          width: 100%;
          height: 100vh;
          padding: 20px;
          background: #f0f0f0;
        }

        .video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 80px;
        }

        .video-container {
          position: relative;
          aspect-ratio: 16/9;
          background: #000;
          border-radius: 8px;
          overflow: hidden;
        }

        .video-stream {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .participant-name {
          position: absolute;
          bottom: 10px;
          left: 10px;
          background: rgba(0, 0, 0, 0.5);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 14px;
        }

        .controls {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 10px;
          background: white;
          padding: 15px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .control-button {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          background: #007bff;
          color: white;
          cursor: pointer;
          font-size: 14px;
          transition: background 0.3s ease;
        }

        .control-button:hover {
          background: #0056b3;
        }

        .control-button.disabled {
          background: #dc3545;
        }

        .control-button.disabled:hover {
          background: #bd2130;
        }
      `}</style>
    </div>
  );
};

export default VideoConference;
