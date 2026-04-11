import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  GitBranch,
  Play,
  Shield,
  ExternalLink,
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/agents", icon: Users, label: "Agents" },
  { to: "/delegations", icon: GitBranch, label: "Delegations" },
  { to: "/demo", icon: Play, label: "Live Demo" },
];

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 glass-strong z-50 flex flex-col">
      {/* Logo */}
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

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
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
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(142,76%,36%)]/10">
          <div className="w-2 h-2 rounded-full bg-[hsl(142,76%,36%)] animate-pulse" />
          <span className="text-xs text-[hsl(142,76%,36%)]">Base Sepolia</span>
        </div>
        <a
          href="https://sepolia.basescan.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          BaseScan Explorer
        </a>
      </div>
    </aside>
  );
}
