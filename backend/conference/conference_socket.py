# conferences/room_manager.py
from typing import Dict
# conferences/routes.py
from main import sio

class RoomManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, str]] = {}
        self.sessions: Dict[str, Dict[str, str]] = {}
        self.screen_sharing: Dict[str, str] = {}  # Track screen-sharing users per room

    def add_participant(self, room_id: str, user_id: str, sid: str) -> None:
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        
        self.rooms[room_id][user_id] = sid
        self.sessions[sid] = {"room_id": room_id, "user_id": user_id}

    def remove_participant(self, sid: str) -> tuple[str, str, list[str]] | None:
        if sid not in self.sessions:
            return None
        
        session = self.sessions[sid]
        room_id = session["room_id"]
        user_id = session["user_id"]
        
        if room_id in self.rooms:
            self.rooms[room_id].pop(user_id, None)
            
            if not self.rooms[room_id]:
                del self.rooms[room_id]
            else:
                remaining_participants = list(self.rooms[room_id].keys())
                return room_id, user_id, remaining_participants
        
        if room_id in self.screen_sharing and self.screen_sharing[room_id] == user_id:
            del self.screen_sharing[room_id]  # Remove screen-sharing user if they leave

        del self.sessions[sid]
        return None

    def get_room_participants(self, room_id: str) -> list[str]:
        return list(self.rooms.get(room_id, {}).keys())

    def get_participant_sid(self, room_id: str, user_id: str) -> str | None:
        return self.rooms.get(room_id, {}).get(user_id)

    def set_screen_sharing(self, room_id: str, user_id: str) -> None:
        """Mark a user as the screen-sharer for a room."""
        self.screen_sharing[room_id] = user_id

    def stop_screen_sharing(self, room_id: str) -> None:
        """Stop screen sharing in a room."""
        if room_id in self.screen_sharing:
            del self.screen_sharing[room_id]

    def get_screen_sharer(self, room_id: str) -> str | None:
        """Get the current screen-sharing user in a room."""
        return self.screen_sharing.get(room_id)
    
    def is_screen_sharing_active(self, room_id: str) -> bool:
        return room_id in self.screen_sharing

    def can_start_screen_sharing(self, room_id: str, user_id: str) -> bool:
        return not self.is_screen_sharing_active(room_id) or self.screen_sharing[room_id] == user_id

# Create global room manager instance
room_manager = RoomManager()


@sio.on("connect")
async def connect(sid, environ):
    print(f"🔗 Client connected: {sid}")

@sio.on("disconnect")
async def disconnect(sid):
    print(f"❌ Client disconnected: {sid}")

@sio.on("join")
async def join_video_conferencing(sid, data):
    """Handles users joining video/audio conferencing."""
    print(f"📥 Join event received: {data}")

    if not data or "room_id" not in data or "user_id" not in data:
        print("❌ Invalid join payload:", data)
        return

    room_id = data["room_id"]
    user_id = data["user_id"]

    # Add user to room management
    room_manager.add_participant(room_id, user_id, sid)
    
    # Join socket.io room
    await sio.enter_room(sid, room_id)
    print(f"👤 {user_id} successfully joined Room {room_id}")

    # Get existing participants
    participants = room_manager.get_room_participants(room_id)
    print(f"📢 Room {room_id} participants: {participants}")

    # Broadcast to others in the room
    await sio.emit(
        "user_joined",
        {"room_id": room_id, "userId": user_id},
        room=room_id,
        skip_sid=sid
    )

    print("user joined")

@sio.on("user_joined")
async def handle_user_joined(sid, data):
    """Handles incoming user_joined event from other clients."""
    print(f"�� User {data['userId']} joined the room")

   

@sio.on("disconnect")
async def handle_disconnect(sid):
    """Handle client disconnection"""
    result = room_manager.remove_participant(sid)
    
    if result:
        room_id, user_id, remaining_participants = result
        print(f"👋 User {user_id} left room {room_id}")
        
        # Notify remaining participants
        await sio.emit(
            "user_left",
            {"room_id": room_id, "userId": user_id},
            room=room_id
        )

@sio.on("offer")
async def handle_offer(sid, data):
    """Handles WebRTC offer from one peer to another."""
    print(f"📡 Offer received from {data['user_id']} -> {data['target_user_id']}")
    
    # Verify users are in the same room
    room_id = data["room_id"]
    target_sid = room_manager.get_participant_sid(room_id, data["target_user_id"])
    
    if target_sid:
        await sio.emit("offer", data, room=target_sid)
    else:
        print(f"❌ Target user {data['target_user_id']} not found in room {room_id}")

@sio.on("answer")
async def handle_answer(sid, data):
    """Handles WebRTC answer from one peer to another."""
    print(f"✅ Answer received from {data['user_id']} -> {data['target_user_id']}")
    
    # Send answer to specific user
    target_sid = room_manager.get_participant_sid(data["room_id"], data["target_user_id"])
    if target_sid:
        await sio.emit("answer", data, room=target_sid)

@sio.on("ice-candidate")
async def handle_ice_candidate(sid, data):
    """Handles ICE candidates for peer connection."""
    print(f"Received ICE Candidate data: {data}")

    if not isinstance(data, dict):
        print("🚨 Error: ICE candidate data is not a dictionary!")
        return

    required_keys = ["user_id", "room_id", "target_user_id", "candidate"]
    missing_keys = [key for key in required_keys if key not in data]

    if missing_keys:
        print(f"🚨 Missing keys in ICE candidate data: {missing_keys}")
        return

    print(f"❄️ ICE Candidate received from {data['user_id']}")
    
    # Send candidate to specific user
    target_sid = room_manager.get_participant_sid(data["room_id"], data["target_user_id"])
    if target_sid:
        await sio.emit("ice-candidate", data, room=target_sid)

@sio.on("screen_offer")
async def handle_screen_offer(sid, data):
    print(f"📡 Screen Offer received from {data['user_id']} -> {data['target_user_id']}")
    
    room_id = data["room_id"]
    user_id = data["user_id"]
    
    if not room_manager.can_start_screen_sharing(room_id, user_id):
        await sio.emit("screen_sharing_error", {
            "message": "Another user is already sharing their screen"
        }, room=sid)
        return
    if not isinstance(data, dict):
        print("🚨 Error: Screen offer data is not a dictionary!")
        return

    required_keys = ["user_id", "room_id", "target_user_id", "sdp"]
    missing_keys = [key for key in required_keys if key not in data]

    if missing_keys:
        print(f"🚨 Missing keys in screen offer data: {missing_keys}")
        return
    
    target_sid = room_manager.get_participant_sid(room_id, data["target_user_id"])
    
    if target_sid:
        await sio.emit("screen_offer", data, room=target_sid)
        room_manager.set_screen_sharing(room_id, data["user_id"])
        
        # Notify all users in the room about screen sharing
        await sio.emit("screen_sharing_started", {"room_id": room_id, "userId": data["user_id"]}, room=room_id)
    else:
        print(f"❌ Target user {data['target_user_id']} not found in room {room_id}")

@sio.on("screen_answer")
async def handle_screen_answer(sid, data):
    print(f"✅ Screen Answer received from {data['user_id']} -> {data['target_user_id']}")
    
    target_sid = room_manager.get_participant_sid(data["room_id"], data["target_user_id"])
    if target_sid:
        await sio.emit("screen_answer", data, room=target_sid)

@sio.on("screen_share_stopped")
async def handle_screen_share_stopped(sid, data):
    print(f"🛑 Screen sharing stopped by {data['user_id']}")
    
    room_id = data["room_id"]
    room_manager.stop_screen_sharing(room_id)
    
    # Notify all users in the room
    await sio.emit("screen_share_stopped", {"room_id": room_id, "userId": data["user_id"]}, room=room_id)

@sio.on("screen_ice_candidate")
async def handle_screen_ice_candidate(sid, data):
    print(f"❄️ Screen ICE Candidate received from {data['user_id']}")
    
    target_sid = room_manager.get_participant_sid(data["room_id"], data["target_user_id"])
    if target_sid:
        await sio.emit("screen_ice_candidate", data, room=target_sid)    