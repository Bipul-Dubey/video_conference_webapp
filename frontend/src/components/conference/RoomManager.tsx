import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import "./RoomManager.css";

const RoomManager = () => {
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const createRoom = () => {
    const newRoomId = uuidv4().slice(0, 8);
    setRoomId(newRoomId);
  };

  const joinRoom = () => {
    if (roomId.trim()) {
      navigate(`/room/${roomId}`);
    } else {
      setError("⚠️ Please enter a valid Room ID");
      setTimeout(() => setError(""), 2500);
    }
  };

  return (
    <div className="room-container">
      <h2>AI Interview Room</h2>

      <button onClick={createRoom} className="btn-primary">
        Create New Room
      </button>

      <div className="input-group">
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Enter Room ID"
          className="input-field"
        />
        <button onClick={joinRoom} className="btn-secondary">
          Join Room
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
    </div>
  );
};

export default RoomManager;
