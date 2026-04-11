import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import TlsnDemo from "./pages/TlsnDemo";
import Demo from "./pages/Demo";
import LiveDemo from "./pages/LiveDemo";
import LayerConsole from "./pages/LayerConsole";
import Landing from "./pages/Landing";

/** Landing page at root, sidebar-wrapped app under /app/* */
function AppShell() {
  return (
    <div className="min-h-screen bg-background bg-grid dark">
      <Sidebar />
      <main className="ml-64 p-8 max-w-[1400px]">
        <Routes>
          <Route path="tlsn" element={<TlsnDemo />} />
          <Route path="live-demo" element={<LiveDemo />} />
          <Route path="demo" element={<Demo />} />
          <Route path="layer" element={<LayerConsole />} />
          {/* default inner page */}
          <Route index element={<TlsnDemo />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <div className="dark">
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Keep legacy direct routes working */}
        <Route path="/live-demo" element={
          <div className="min-h-screen bg-background bg-grid dark">
            <Sidebar />
            <main className="ml-64 p-8 max-w-[1400px]">
              <LiveDemo />
            </main>
          </div>
        } />
        <Route path="/demo" element={
          <div className="min-h-screen bg-background bg-grid dark">
            <Sidebar />
            <main className="ml-64 p-8 max-w-[1400px]">
              <Demo />
            </main>
          </div>
        } />
        <Route path="/tlsn" element={
          <div className="min-h-screen bg-background bg-grid dark">
            <Sidebar />
            <main className="ml-64 p-8 max-w-[1400px]">
              <TlsnDemo />
            </main>
          </div>
        } />
        <Route path="/layer" element={
          <div className="min-h-screen bg-background bg-grid dark">
            <Sidebar />
            <main className="ml-64 p-8 max-w-[1400px]">
              <LayerConsole />
            </main>
          </div>
        } />
      </Routes>
    </div>
  );
}

export default App;
