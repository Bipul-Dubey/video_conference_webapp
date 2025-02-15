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
  const screenPeerConnections = useRef(new Map());
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [peerScreens, setPeerScreens] = useState(new Map());

  useEffect(() => {
    const newSocket = io("https://5b05-124-253-101-212.ngrok-free.app", {
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

    // Add screen share specific handlers
    socket.on("screen_offer", async (data) => {
      console.log("Received screen offer from:", data.user_id);
      try {
        const pc = await createScreenPeerConnection(data.user_id);
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("screen_answer", {
          room_id: roomId,
          user_id: userId,
          target_user_id: data.user_id,
          sdp: answer,
        });
      } catch (err) {
        console.error("Error handling screen offer:", err);
      }
    });

    socket.on("screen_answer", async (data) => {
      console.log("Received screen answer from:", data.user_id);
      try {
        const pc = screenPeerConnections.current.get(data.user_id);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } catch (err) {
        console.error("Error handling screen answer:", err);
      }
    });

    socket.on("screen_ice_candidate", async (data) => {
      try {
        const pc = screenPeerConnections.current.get(data.user_id);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error("Error handling screen ICE candidate:", err);
      }
    });

    return () => {
      socket.off("user_joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("user_left");
      socket.off("screen_offer");
      socket.off("screen_answer");
      socket.off("screen_ice_candidate");
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

  const createScreenPeerConnection = async (peerId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      iceCandidatePoolSize: 10,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit("screen_ice_candidate", {
          room_id: roomId,
          user_id: userId,
          target_user_id: peerId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("Received screen track from:", peerId);
      setPeerScreens(prev => {
        const newScreens = new Map(prev);
        newScreens.set(peerId, event.streams[0]);
        return newScreens;
      });
    };

    screenPeerConnections.current.set(peerId, pc);
    return pc;
  };

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
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });

        setScreenStream(stream);

        // Create separate peer connections for screen sharing
        for (const [peerId] of peerConnections.current.entries()) {
          const pc = await createScreenPeerConnection(peerId);

          stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream);
          });

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socket?.emit("screen_offer", {
            room_id: roomId,
            user_id: userId,
            target_user_id: peerId,
            sdp: offer,
          });
        }

        stream.getVideoTracks()[0].onended = () => {
          stopScreenSharing();
        };

        setScreenSharing(true);
      } catch (err) {
        console.error("Error starting screen share:", err);
      }
    } else {
      stopScreenSharing();
    }
  };

  const stopScreenSharing = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());

      // Clean up screen peer connections
      screenPeerConnections.current.forEach(pc => {
        pc.close();
      });
      screenPeerConnections.current.clear();

      setScreenStream(null);
      setPeerScreens(new Map());
      setScreenSharing(false);
    }
  };

  return (
    <div className="video-conference">
      {/* Any active screen shares - at top */}
      {(screenSharing || peerScreens.size > 0) && (
        <div className="active-screen-container">
          {/* Local screen share */}
          {screenSharing && screenStream && (
            <div className="screen-container active-screen">
              <video
                autoPlay
                playsInline
                className="screen-stream"
                ref={(el) => {
                  if (el) el.srcObject = screenStream;
                }}
              />
              <div className="screen-name">Your Screen</div>
            </div>
          )}

          {/* Peer screen shares */}
          {Array.from(peerScreens.entries()).map(([peerId, stream]) => (
            <div key={`${peerId}_screen`} className="screen-container active-screen">
              <video
                autoPlay
                playsInline
                className="screen-stream"
                ref={(el) => {
                  if (el) el.srcObject = stream;
                }}
              />
              <div className="screen-name">{`${peerId}'s Screen`}</div>
            </div>
          ))}
        </div>
      )}

      {/* Video grid */}
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
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .active-screen-container {
          width: 100%;
          display: flex;
          justify-content: center;
          margin-bottom: 20px;
        }

        .active-screen {
          width: 100%;
          max-width: 800px; /* Approximately double the width of video containers */
          margin: 0 auto;
        }

        .video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 20px;
        }

        .video-container, .screen-container {
          position: relative;
          aspect-ratio: 16/9;
          background: #000;
          border-radius: 8px;
          overflow: hidden;
        }

        .video-stream, .screen-stream {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .participant-name, .screen-name {
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
