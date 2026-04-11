import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import TlsnDemo from "./pages/TlsnDemo";
import LiveDemo from "./pages/LiveDemo";
import LayerConsole from "./pages/LayerConsole";
import Landing from "./pages/Landing";

function ShellLayout({ children }) {
  return (
    <div className="min-h-screen bg-nb-bg">
      <Sidebar />
      <main className="max-w-[1400px] md:ml-64 px-4 pt-6 pb-24 sm:px-6 sm:pt-8 md:pb-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}

/** Landing page at root, sidebar-wrapped app under /app/* */
function AppShellRoutes() {
  return (
    <ShellLayout>
        <Routes>
          <Route path="tlsn" element={<TlsnDemo />} />
          <Route path="live-demo" element={<LiveDemo />} />
          <Route path="layer" element={<LayerConsole />} />
          {/* default inner page */}
          <Route index element={<TlsnDemo />} />
        </Routes>
    </ShellLayout>
  );
}

function App() {
  return (
    <div className="bg-nb-bg">
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Keep legacy direct routes working */}
        <Route path="/live-demo" element={<ShellLayout><LiveDemo /></ShellLayout>} />
        <Route path="/tlsn" element={<ShellLayout><TlsnDemo /></ShellLayout>} />
        <Route path="/layer" element={<ShellLayout><LayerConsole /></ShellLayout>} />
        <Route path="/app/*" element={<AppShellRoutes />} />
      </Routes>
    </div>
  );
}

export default App;
