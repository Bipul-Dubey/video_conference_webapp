import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import VideoManager from "./components/conference/VideoManager";
import RoomManager from "./components/conference/RoomManager";

function App() {

  return (
    <Router>
      <Routes>
        <Route path="/" element={<RoomManager />} />
        <Route path="/room/:roomId" element={<VideoManager />} />
      </Routes>
    </Router>
  )
}

export default App
