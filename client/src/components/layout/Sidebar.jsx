import { NavLink } from "react-router-dom";
import {
  Compass,
  FlaskConical,
  LayoutGrid,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";

const navItems = [
  { to: "/layer", label: "Layer", icon: LayoutGrid, end: false },
  { to: "/tlsn", label: "TLSN", icon: Shield, end: true },
  { to: "/live-demo", label: "Live", icon: Sparkles, end: false },
  { to: "/demo", label: "Quick", icon: FlaskConical, end: false },
];

function NavItem({ item, compact = false }) {
  return (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          "group inline-flex items-center gap-3 border-2 border-nb-ink text-sm font-display font-semibold transition-all",
          compact ? "justify-center rounded-nb px-3 py-2 text-xs" : "w-full rounded-nb px-4 py-2.5",
          isActive
            ? "bg-nb-accent text-nb-ink shadow-nb-sm -translate-y-0.5"
            : "bg-nb-card text-nb-ink hover:bg-nb-accent/30 hover:-translate-y-0.5 active:translate-y-0",
        ].join(" ")
      }
    >
      <item.icon className={compact ? "h-4 w-4" : "h-4 w-4"} />
      <span className={compact ? "sr-only" : ""}>{item.label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  return (
    <>
      <aside className="fixed left-0 top-0 hidden h-screen w-64 flex-col border-r-[3px] border-nb-ink bg-nb-bg px-4 py-6 md:flex">
        <NavLink
          to="/"
          className="mb-8 inline-flex items-center gap-2 px-2 text-nb-ink active:scale-[0.99]"
        >
          <Zap className="h-5 w-5 text-nb-accent" />
          <span className="font-display text-2xl font-bold tracking-tight">DCT Protocol</span>
        </NavLink>

        <div className="mb-3 px-2 text-[11px] font-display font-bold uppercase tracking-[0.16em] text-nb-ink/50">
          Navigation
        </div>
        <nav className="space-y-2">
          {navItems.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>

        <div className="mt-auto nb-card-sm">
          <p className="text-[11px] font-display font-bold uppercase tracking-wider text-nb-ink/50">Network</p>
          <p className="mt-1 text-sm font-display font-bold text-nb-ink">Base Sepolia</p>
          <p className="mt-2 text-xs leading-relaxed text-nb-ink/60">
            Protocol playground for delegation flows, TLSNotary proofs, and layer orchestration.
          </p>
          <a
            href="https://sepolia.basescan.org"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-xs font-display font-semibold text-nb-ink hover:text-nb-accent"
          >
            <Compass className="h-3.5 w-3.5" />
            View on BaseScan
          </a>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t-[3px] border-nb-ink bg-nb-bg p-2 md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1.5">
          {navItems.map((item) => (
            <NavItem key={item.to} item={item} compact />
          ))}
        </div>
      </nav>
    </>
  );
}
