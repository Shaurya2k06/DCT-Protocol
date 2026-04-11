import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Globe,
  Pause,
  Play,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-110px" },
  transition: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1], delay },
});

const SIM_STEPS = [
  {
    title: "Root authority minted",
    desc: "Orchestrator token created with broad but bounded capability set.",
    stage: "init",
  },
  {
    title: "A -> B attenuation",
    desc: "Research agent receives strict tool and spend subset.",
    stage: "ab",
  },
  {
    title: "B -> C attenuation",
    desc: "Payment agent receives narrow child scope.",
    stage: "bc",
  },
  {
    title: "Cascade revocation",
    desc: "Root is revoked and descendants fail lineage checks.",
    stage: "revoke",
  },
];

const LAYERS = [
  ["Eclipse Biscuit", "Off-chain attenuation token"],
  ["DCTRegistry", "On-chain revocation lineage"],
  ["DCTEnforcer", "ERC-7710 caveat validation"],
  ["TLSNotary", "MPC-TLS action proof"],
];

const ATTACKS = [
  ["Scope widening", "Datalog attenuation is inexpressible to widen."],
  ["Forged lineage", "Each block is signed by previous holder key."],
  ["Revocation evasion", "Lineage walk checks every ancestor on execute()."],
  ["Token replay", "Attestations bind nonce and timestamp."],
  ["Identity spoofing", "ERC-8004 ownerOf(agentId) is canonical."],
];

const STACK_ROWS = [
  ["Token", "Eclipse Biscuit v3", "npm i @biscuit-auth/biscuit-wasm"],
  ["Delegation", "ERC-7710 Delegation Framework", "forge install metamask/delegation-framework"],
  ["Identity", "ERC-8004", "eips.ethereum.org/EIPS/eip-8004"],
  ["Proof", "TLSNotary MPC-TLS", "cargo add tlsn"],
  ["SDK", "MetaMask Delegation Toolkit", "npm i @metamask/delegation-toolkit"],
  ["AA", "ERC-4337 via Pimlico", "npm i permissionless"],
  ["Chain", "Base Sepolia", "RPC: sepolia.base.org"],
];

const TRUST_SERIES = {
  orchestrator: [100, 100, 100, 100, 100, 100],
  research: [0, 24, 51, 66, 72, 39],
  payment: [0, 0, 18, 42, 59, 12],
};

const GAS_SERIES = [
  ["delegate()", 118200, "bg-nb-accent"],
  ["execute()", 84200, "bg-nb-ok"],
  ["revoke()", 43400, "bg-nb-error"],
  ["lineage walk", 6400, "bg-nb-warn"],
];

const TX_STREAM = [
  ["0x91…a3c1", "registerDelegation", "success"],
  ["0xb8…1dd4", "execute", "success"],
  ["0xcd…77fe", "revoke", "success"],
  ["0xf1…032b", "execute", "reverted"],
];

function DelegationTopology({ stage }) {
  const revoked = stage === "revoke";
  const a = revoked ? "#EF4444" : "#111111";
  const b = revoked ? "#EF4444" : stage === "ab" || stage === "bc" ? "#60A5FA" : "#94a3b8";
  const c = revoked ? "#EF4444" : stage === "bc" ? "#60A5FA" : "#94a3b8";

  return (
    <svg viewBox="0 0 360 210" className="h-[210px] w-full rounded-nb border-2 border-nb-ink bg-nb-bg">
      <line x1="80" y1="56" x2="180" y2="108" stroke={stage === "ab" || stage === "bc" || revoked ? "#60A5FA" : "#d1d5db"} strokeWidth="2.5" strokeDasharray="5 4" />
      <line x1="180" y1="108" x2="280" y2="160" stroke={stage === "bc" || revoked ? "#60A5FA" : "#d1d5db"} strokeWidth="2.5" strokeDasharray="5 4" />

      <circle cx="80" cy="56" r="22" fill={a} stroke="#111" strokeWidth="2" />
      <circle cx="180" cy="108" r="22" fill={b} stroke="#111" strokeWidth="2" />
      <circle cx="280" cy="160" r="22" fill={c} stroke="#111" strokeWidth="2" />

      <text x="80" y="60" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">A</text>
      <text x="180" y="112" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">B</text>
      <text x="280" y="164" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">C</text>

      <text x="80" y="30" textAnchor="middle" fill="#111" fontSize="10" fontWeight="600">orchestrator</text>
      <text x="180" y="83" textAnchor="middle" fill="#111" fontSize="10" fontWeight="600">research</text>
      <text x="280" y="135" textAnchor="middle" fill="#111" fontSize="10" fontWeight="600">payment</text>

      {revoked && (
        <g>
          <rect x="35" y="182" width="290" height="22" rx="11" fill="#FEE2E2" stroke="#111" strokeWidth="2" />
          <text x="180" y="197" textAnchor="middle" fill="#EF4444" fontSize="10" fontWeight="700">
            revoked ancestor found {"→"} downstream execution blocked
          </text>
        </g>
      )}
    </svg>
  );
}

function TrustChart() {
  const width = 560;
  const height = 240;
  const padX = 40;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const pointFor = (idx, value) => {
    const x = padX + (idx / (TRUST_SERIES.orchestrator.length - 1)) * innerW;
    const y = padY + ((100 - value) / 100) * innerH;
    return `${x},${y}`;
  };

  const lines = [
    ["orchestrator", "#111111", "orchestrator"],
    ["research", "#60A5FA", "research"],
    ["payment", "#10B981", "payment"],
  ];

  return (
    <div className="nb-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-display font-bold text-nb-ink">Trust trajectory</h3>
        <div className="flex items-center gap-3 text-xs text-nb-ink/60 font-display font-semibold">
          {lines.map(([key, color, label]) => (
            <span key={key} className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-full border-2 border-nb-ink" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-[230px] w-full rounded-nb border-2 border-nb-ink bg-nb-bg">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padY + ((100 - tick) / 100) * innerH;
          return (
            <g key={tick}>
              <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#d1d5db" strokeWidth="1" />
              <text x="10" y={y + 4} fill="#111" fontSize="10" fontWeight="600">{tick}</text>
            </g>
          );
        })}

        {lines.map(([key, color]) => (
          <polyline
            key={key}
            fill="none"
            stroke={color}
            strokeWidth="3"
            points={TRUST_SERIES[key].map((v, idx) => pointFor(idx, v)).join(" ")}
          />
        ))}
      </svg>
    </div>
  );
}

function GasBars() {
  const max = Math.max(...GAS_SERIES.map(([, v]) => v));

  return (
    <div className="nb-card">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-nb-ink" />
        <h3 className="text-sm font-display font-bold text-nb-ink">Gas profile</h3>
      </div>

      <div className="space-y-3">
        {GAS_SERIES.map(([label, value, hue]) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between text-xs text-nb-ink/70 font-display font-semibold">
              <span>{label}</span>
              <span className="font-mono">{value.toLocaleString()}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-nb-bg border-2 border-nb-ink">
              <div className={`h-full ${hue}`} style={{ width: `${(value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TxFeed() {
  return (
    <div className="nb-card">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-nb-ink" />
        <h3 className="text-sm font-display font-bold text-nb-ink">Transaction stream</h3>
      </div>

      <div className="space-y-2.5">
        {TX_STREAM.map(([hash, method, status]) => (
          <div key={hash} className="flex items-center justify-between rounded-nb border-2 border-nb-ink bg-nb-bg px-3 py-2 text-xs">
            <div>
              <p className="font-mono font-semibold text-nb-ink">{hash}</p>
              <p className="text-nb-ink/60">{method}</p>
            </div>
            <span className={`nb-pill ${status === "success" ? "bg-nb-ok text-white" : "bg-nb-error text-white"}`}>
              {status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const [activeAttack, setActiveAttack] = useState(0);
  const [simStep, setSimStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setSimStep((prev) => (prev + 1) % SIM_STEPS.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [playing]);

  const simTone = useMemo(() => {
    if (simStep === 3) return "border-nb-error bg-nb-error/10 text-nb-error";
    if (simStep === 2) return "border-nb-ok bg-nb-ok/10 text-nb-ok";
    return "border-nb-accent-2 bg-nb-accent-2/10 text-nb-accent-2";
  }, [simStep]);

  return (
    <div className="bg-nb-bg min-h-screen">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b-[3px] border-nb-ink bg-nb-card">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Link to="/" className="inline-flex items-center gap-2 text-nb-ink active:scale-[0.99]">
              <Zap className="h-5 w-5 text-nb-accent" />
              <span className="font-display text-2xl font-bold tracking-tight">DCT Protocol</span>
            </Link>
            <nav className="hidden items-center gap-2 md:flex">
              {[
                ["Simulation", "simulation"],
                ["Architecture", "architecture"],
                ["Security", "security"],
                ["Stack", "stack"],
              ].map(([label, id]) => (
                <a key={id} href={`#${id}`} className="rounded-nb border-2 border-transparent px-3 py-1.5 text-sm font-display font-semibold text-nb-ink/60 hover:border-nb-ink hover:bg-nb-accent/20 hover:text-nb-ink transition-all">
                  {label}
                </a>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <a href="https://sepolia.basescan.org" target="_blank" rel="noopener noreferrer" className="hidden items-center gap-1 text-sm font-display font-semibold text-nb-ink/60 hover:text-nb-ink sm:inline-flex">
              BaseScan <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
            <Link to="/live-demo" className="nb-btn-primary text-sm">
              Open live demo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div>
          <motion.div {...fadeUp()} className="nb-pill-accent">
            <Sparkles className="h-3 w-3" />
            Simulation-grade landing
          </motion.div>

          <motion.h1 {...fadeUp(0.05)} className="font-display mt-6 max-w-3xl text-4xl font-bold leading-[1.1] text-nb-ink sm:text-5xl">
            Cryptographic delegation,
            <br />
            visualized like an operations console.
          </motion.h1>

          <motion.p {...fadeUp(0.1)} className="mt-6 max-w-2xl text-base leading-relaxed text-nb-ink/70 font-body">
            DCT gives multi-agent systems a strict authority flow: attenuation by construction,
            on-chain lineage checks, and cascade revocation that fails fast at execution time.
          </motion.p>

          <motion.div {...fadeUp(0.15)} className="mt-8 flex flex-wrap gap-3">
            <Link to="/live-demo" className="nb-btn-primary">
              Explore protocol <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener noreferrer" className="nb-btn-ghost">
              ERC-8004 <ArrowUpRight className="h-4 w-4" />
            </a>
          </motion.div>

          <motion.div {...fadeUp(0.2)} className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              ["Revocation write", "O(1)", "single SSTORE", "bg-nb-accent"],
              ["Lineage walk", "~6.4k gas", "MAX_DEPTH = 8", "bg-nb-accent-2"],
              ["Attestation", "65 bytes", "compact notary proof", "bg-nb-warn"],
              ["Widening", "Impossible", "Datalog attenuation", "bg-nb-error"],
            ].map(([label, value, detail, bg]) => (
              <div key={label} className="nb-card-sm hover:-translate-y-0.5 active:translate-y-0 transition-transform">
                <p className="text-xs font-display font-bold uppercase tracking-wide text-nb-ink/50">{label}</p>
                <p className="mt-1 text-xl font-display font-bold text-nb-ink">{value}</p>
                <p className="text-xs text-nb-ink/60">{detail}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* ── Delegation Simulator ── */}
        <motion.aside {...fadeUp(0.1)} className="nb-card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-display font-bold text-nb-ink">Delegation simulator</h3>
            <button type="button" onClick={() => setPlaying((v) => !v)} className="nb-pill hover:bg-nb-accent/30 transition-colors">
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? "Pause" : "Play"}
            </button>
          </div>

          <DelegationTopology stage={SIM_STEPS[simStep].stage} />

          <div className={`mt-4 rounded-nb border-2 px-3 py-2 font-display ${simTone}`}>
            <p className="text-xs font-bold">{SIM_STEPS[simStep].title}</p>
            <p className="text-xs opacity-90">{SIM_STEPS[simStep].desc}</p>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {SIM_STEPS.map((step, idx) => (
              <button
                key={step.title}
                type="button"
                onClick={() => setSimStep(idx)}
                className={`h-3 rounded-full border-2 border-nb-ink transition-colors ${simStep === idx ? "bg-nb-ink" : "bg-nb-bg hover:bg-nb-accent/30"}`}
                aria-label={`Go to simulation step ${idx + 1}`}
              />
            ))}
          </div>

          <div className="mt-4 text-[11px] font-display font-semibold text-nb-ink/50">
            simulated execution path: A {"→"} B {"→"} C, then revoke(A)
          </div>
        </motion.aside>
      </section>

      {/* ── Charts Section ── */}
      <section id="simulation" className="border-y-[3px] border-nb-ink py-14 bg-nb-bg">
        <div className="mx-auto grid w-full max-w-[1280px] gap-5 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <TrustChart />
          <div className="space-y-5">
            <GasBars />
            <TxFeed />
          </div>
        </div>
      </section>

      {/* ── Architecture ── */}
      <section id="architecture" className="border-b-[3px] border-nb-ink">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6">
          <h2 className="font-display text-3xl font-bold text-nb-ink sm:text-4xl">Layer choreography</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {LAYERS.map(([name, desc], idx) => (
              <div key={name} className="nb-card hover:-translate-y-1 transition-transform">
                <p className="text-[11px] font-display font-bold uppercase tracking-wider text-nb-ink/40">Layer {idx + 1}</p>
                <p className="mt-2 text-base font-display font-bold text-nb-ink">{name}</p>
                <p className="mt-2 text-sm leading-relaxed text-nb-ink/70">{desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-nb-ink/60 font-display font-semibold">
            {["Biscuit", "DCTRegistry", "DCTEnforcer", "TLSNotary"].map((name, idx) => (
              <div key={name} className="inline-flex items-center gap-2">
                <span className="nb-pill">{name}</span>
                {idx !== 3 && <ChevronRight className="h-3.5 w-3.5 text-nb-ink" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Security ── */}
      <section id="security" className="border-b-[3px] border-nb-ink py-16">
        <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold text-nb-ink sm:text-4xl">Security matrix</h2>
          <div className="mt-8 overflow-hidden rounded-nb border-2 border-nb-ink bg-nb-card shadow-nb">
            <div className="grid grid-cols-[220px_1fr] border-b-2 border-nb-ink bg-nb-accent/20 px-5 py-3 text-xs font-display font-bold uppercase tracking-wider text-nb-ink">
              <div>Threat</div>
              <div>Mitigation path</div>
            </div>
            {ATTACKS.map(([attack, defense], idx) => (
              <button
                key={attack}
                type="button"
                onClick={() => setActiveAttack(idx === activeAttack ? -1 : idx)}
                className={`grid w-full grid-cols-[220px_1fr] border-b-2 border-nb-ink px-5 py-4 text-left transition-colors last:border-b-0 ${
                  activeAttack === idx ? "bg-nb-accent/15" : "bg-nb-card hover:bg-nb-accent/5"
                }`}
              >
                <span className="text-sm font-display font-bold text-nb-ink">{attack}</span>
                <span className="text-sm text-nb-ink/70">{defense}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stack ── */}
      <section id="stack" className="border-b-[3px] border-nb-ink py-16">
        <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold text-nb-ink sm:text-4xl">Open technology stack</h2>
          <div className="mt-8 overflow-hidden rounded-nb border-2 border-nb-ink bg-nb-card shadow-nb">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b-2 border-nb-ink bg-nb-accent-2/15">
                  <th className="px-5 py-3 text-xs font-display font-bold uppercase tracking-wider text-nb-ink">Layer</th>
                  <th className="px-5 py-3 text-xs font-display font-bold uppercase tracking-wider text-nb-ink">Technology</th>
                  <th className="hidden px-5 py-3 text-xs font-display font-bold uppercase tracking-wider text-nb-ink md:table-cell">Install</th>
                </tr>
              </thead>
              <tbody>
                {STACK_ROWS.map(([layer, tech, install]) => (
                  <tr key={layer} className="border-b-2 border-nb-ink last:border-b-0 hover:bg-nb-accent/5 transition-colors">
                    <td className="px-5 py-3 text-sm text-nb-ink/70 font-display font-semibold">{layer}</td>
                    <td className="px-5 py-3 text-sm font-display font-bold text-nb-ink">{tech}</td>
                    <td className="hidden px-5 py-3 font-mono text-xs text-nb-ink/60 md:table-cell">{install}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-[960px] px-4 text-center sm:px-6">
          <h2 className="font-display text-4xl font-bold leading-tight text-nb-ink sm:text-5xl">
            Authority attenuation,
            <br />
            with revocation you can trust.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base text-nb-ink/70">
            Infrastructure is live on Base Sepolia. Start from the live demo and inspect the full execution path.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/live-demo" className="nb-btn-primary">
              Explore protocol <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="https://eips.ethereum.org/EIPS/eip-7710" target="_blank" rel="noopener noreferrer" className="nb-btn-ghost">
              ERC-7710 spec <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t-[3px] border-nb-ink bg-nb-card py-7">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-start justify-between gap-4 px-4 text-sm text-nb-ink/60 sm:flex-row sm:items-center sm:px-6">
          <div className="inline-flex items-center gap-2 font-display font-bold">
            <Zap className="h-4 w-4 text-nb-accent" />
            <span>DCT Protocol · MIT</span>
          </div>
          <div className="inline-flex flex-wrap items-center gap-4 font-display font-semibold">
            <a href="https://doc.biscuitsec.org" target="_blank" rel="noopener noreferrer" className="hover:text-nb-ink">
              Biscuit
            </a>
            <a href="https://tlsnotary.org" target="_blank" rel="noopener noreferrer" className="hover:text-nb-ink">
              TLSNotary
            </a>
            <a href="https://docs.pimlico.io" target="_blank" rel="noopener noreferrer" className="hover:text-nb-ink">
              Pimlico
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
