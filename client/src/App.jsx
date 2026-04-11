import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import Dashboard from "./pages/Dashboard";
import Agents from "./pages/Agents";
import Delegations from "./pages/Delegations";
import Demo from "./pages/Demo";

function App() {
  return (
    <div className="min-h-screen bg-background bg-grid">
      <Sidebar />
      <main className="ml-64 p-8 max-w-[1400px]">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/delegations" element={<Delegations />} />
          <Route path="/demo" element={<Demo />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;