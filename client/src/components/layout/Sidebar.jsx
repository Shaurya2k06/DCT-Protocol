import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, Play, Zap, ExternalLink, LayoutGrid } from "lucide-react";

const operateItems = [
  { to: "/layer", label: "Layer console", icon: LayoutGrid, end: false },
];

const demoItems = [
  { to: "/tlsn",      label: "TLSNotary",    icon: Shield, end: true  },
  { to: "/live-demo", label: "Live Demo",     icon: Zap,    end: false },
  { to: "/demo",      label: "Quick demo",   icon: Play,   end: false },
];

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 glass-strong z-50 flex flex-col">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(199,89%,48%)] to-[hsl(265,89%,65%)] flex items-center justify-center glow-blue">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gradient-blue">DCT</h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Protocol
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
        <div>
          <p className="px-4 mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Operate
          </p>
          <div className="space-y-1">
            {operateItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group ${
                    isActive
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={`w-4 h-4 transition-colors ${
                        isActive ? "text-emerald-400" : "text-muted-foreground group-hover:text-foreground"
                      }`}
                    />
                    {item.label}
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator-op"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
        <div>
          <p className="px-4 mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Demo mode
          </p>
          <div className="space-y-1">
            {demoItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group ${
                    isActive
                      ? "bg-[hsl(199,89%,48%)]/10 text-[hsl(199,89%,48%)] glow-blue"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={`w-4 h-4 transition-colors ${
                        isActive
                          ? "text-[hsl(199,89%,48%)]"
                          : "text-muted-foreground group-hover:text-foreground"
                      }`}
                    />
                    {item.label}
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-[hsl(199,89%,48%)]"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-white/10 space-y-3">
        <p className="text-[10px] text-muted-foreground px-3 leading-relaxed">
          Real TLSNotary proofs run in the browser (tlsn-js). The terminal script uses oracle signing unless you add a
          separate prover API.
        </p>
        <a
          href="https://sepolia.basescan.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          BaseScan
        </a>
      </div>
    </aside>
  );
}
