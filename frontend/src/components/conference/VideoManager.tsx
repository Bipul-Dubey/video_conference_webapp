import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import VideoConference from "./VideoConference";

export default function VideoManager() {
  const [uuid, setUuid] = useState<null | string>(null);

  useEffect(() => {
    // Check if UUID exists in localStorage
    let storedUuid = localStorage.getItem("userUUID");

    if (!storedUuid) {
      storedUuid = uuidv4();
      localStorage.setItem("userUUID", storedUuid);
    }

    // Set UUID in state
    setUuid(storedUuid);
  }, []);

  if (!uuid) return <p>Loading...</p>;

  return <VideoConference userId={uuid} />;
}
