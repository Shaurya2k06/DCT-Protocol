import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import TlsnDemo from "./pages/TlsnDemo";
import Demo from "./pages/Demo";

/**
 * Primary UX: browser TLSNotary (/) — real tlsn-js WASM.
 * Secondary: on-chain + Biscuit stepped demo (/demo) — uses API wallet, not full TLSNotary in-browser.
 */
function App() {
  return (
    <div className="min-h-screen bg-background bg-grid">
      <Sidebar />
      <main className="ml-64 p-8 max-w-[1400px]">
        <Routes>
          <Route path="/" element={<TlsnDemo />} />
          <Route path="/demo" element={<Demo />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
