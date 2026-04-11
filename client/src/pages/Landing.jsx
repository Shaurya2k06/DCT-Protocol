import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import {
  Shield,
  Zap,
  Lock,
  GitBranch,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  Check,
  X,
  Key,
  Network,
  Globe,
  Cpu,
  Code2,
  Layers,
  AlertTriangle,
  RefreshCw,
  Terminal,
} from "lucide-react";

/* ─── tiny helpers ─── */
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay },
});

const fadeIn = (delay = 0) => ({
  initial: { opacity: 0 },
  whileInView: { opacity: 1 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, delay },
});

/* ─── data ─── */
const LAYERS = [
  {
    number: "01",
    title: "Eclipse Biscuit",
    subtitle: "Off-Chain Token",
    icon: Key,
    color: "blue",
    glow: "glow-blue",
    accent: "hsl(199 89% 48%)",
    tag: "Ed25519 · Datalog · WASM",
    description:
      "Each delegation hop appends a signed Biscuit block offline — zero server roundtrips. Datalog semantics make scope widening cryptographically inexpressible, not just forbidden by convention.",
    code: `agent_erc8004_id("42");
allowed_tool("research");
spend_limit_usdc(50000000);
// Attenuation block (offline, instant)
check if spend_usdc($s), $s <= 10000000;
check if agent_erc8004_id($id), $id == "87";`,
  },
  {
    number: "02",
    title: "DCTRegistry",
    subtitle: "On-Chain Lineage",
    icon: GitBranch,
    color: "purple",
    glow: "glow-purple",
    accent: "hsl(265 89% 65%)",
    tag: "Solidity · ERC-7710 · Base Sepolia",
    description:
      "Lazy revocation: one O(1) SSTORE cascades through the entire agent tree at execution time. No recursion, no gas bomb. MAX_DEPTH = 8 bounds the walk unconditionally.",
    code: `// Revoke a root → O(1) write
registry.revoke(rootRevId, agentTokenId);

// Child check at execute time → O(depth) SLOADs
function isRevoked(bytes32 id) public view {
  while (id != bytes32(0)) {
    if (directlyRevoked[id]) return true;
    id = parentOf[id]; // walk lineage
  }
}`,
  },
  {
    number: "03",
    title: "DCTEnforcer",
    subtitle: "ERC-7710 Caveat Enforcer",
    icon: Shield,
    color: "green",
    glow: "glow-green",
    accent: "hsl(142 76% 36%)",
    tag: "MetaMask Delegation Framework",
    description:
      "Custom caveat enforcer inside ERC-7710's DelegationManager. Validates four things in sequence before any action executes: revocation lineage, ERC-8004 identity, committed scope hash, TLSNotary attestation.",
    code: `// 4-step check in beforeHook()
require(!registry.isRevoked(revocationId));   // 1
require(erc8004.ownerOf(agentId) == redeemer); // 2
require(_validateScope(committed, tool, spend)); // 3
require(tlsnVerifier.verify(attestation, tool)); // 4`,
  },
  {
    number: "04",
    title: "TLSNotary",
    subtitle: "MPC-TLS Action Verification",
    icon: Globe,
    color: "amber",
    glow: "glow-amber",
    accent: "hsl(38 92% 50%)",
    tag: "Rust · QuickSilver VOLE-IZK",
    description:
      "Agents prove they actually called the declared endpoint using MPC-TLS — no browser required. Notary-signed attestations are compressed to 65 bytes and verified on-chain against the tool hash.",
    code: `// Server-side, no browser context needed
const proof = await tlsnProver.prove({
  url: "https://api.example.com/data",
  notaryUrl: process.env.TLSN_PROVER_URL,
});
// → 65-byte ed25519 attestation
// → verified on-chain by DCTEnforcer`,
  },
];

const SDK_CALLS = [
  {
    call: "delegate()",
    color: "blue",
    accent: "hsl(199 89% 48%)",
    icon: GitBranch,
    steps: [
      "Query trust score → gate spend limit on-chain",
      "Attenuate Biscuit offline (zero network calls)",
      "Register delegation in DCTRegistry on-chain",
    ],
    detail:
      "Parent agent narrows its scope and hands a child a provably limited token. Entire attenuation is a local WASM operation — no server, no oracle.",
  },
  {
    call: "execute()",
    color: "green",
    accent: "hsl(142 76% 36%)",
    icon: Zap,
    steps: [
      "Biscuit Datalog check off-chain (zero gas if blocked)",
      "TLSNotary MPC-TLS proof of HTTP call",
      "DCTEnforcer validates 4 checks on-chain",
    ],
    detail:
      "Two enforcement layers. Datalog blocks scope violations before the transaction is submitted. On-chain enforcer handles revocation, identity, scope commitment, and TLS attestation.",
  },
  {
    call: "revoke()",
    color: "red",
    accent: "hsl(0 72% 51%)",
    icon: X,
    steps: [
      "Single SSTORE → O(1) gas always",
      "All descendants fail isRevoked() lazily",
      "Trust score decays for violating agents",
    ],
    detail:
      "One write kills the entire downstream tree. Children are not actively destroyed — they simply find a revoked ancestor at their next execution attempt.",
  },
];

const SECURITY_ROWS = [
  {
    attack: "Scope widening",
    why: "Biscuit Datalog makes widening inexpressible. check if in block 0 applies across all blocks unconditionally.",
  },
  {
    attack: "Forged lineage",
    why: "Root public key verification. Every block signed by previous holder's ephemeral Ed25519 key.",
  },
  {
    attack: "Revocation evasion",
    why: "isRevoked() walks lineage at execution time. Ancestor flag checked on every call.",
  },
  {
    attack: "Token replay",
    why: "TLSNotary attestations bind to a specific session nonce and timestamp.",
  },
  {
    attack: "Gas exhaustion",
    why: "MAX_DEPTH = 8 caps the walk unconditionally. ~6,400 gas worst case. Enforced at registration.",
  },
  {
    attack: "Identity spoofing",
    why: "erc8004.ownerOf(agentId) == redeemer. On-chain NFT ownership is ground truth.",
  },
];

const STACK = [
  { label: "Eclipse Biscuit v3", tag: "Token", color: "blue" },
  { label: "ERC-7710", tag: "Delegation", color: "purple" },
  { label: "ERC-8004", tag: "Identity", color: "cyan" },
  { label: "TLSNotary", tag: "Proof", color: "amber" },
  { label: "ERC-4337 / Pimlico", tag: "AA", color: "green" },
  { label: "Base Sepolia", tag: "Chain", color: "blue" },
  { label: "Foundry", tag: "Contracts", color: "purple" },
  { label: "OpenZeppelin", tag: "Security", color: "green" },
];

const colorMap = {
  blue: { bg: "bg-[hsl(199,89%,48%)]/10", text: "text-[hsl(199,89%,48%)]", border: "border-[hsl(199,89%,48%)]/20" },
  purple: { bg: "bg-[hsl(265,89%,65%)]/10", text: "text-[hsl(265,89%,65%)]", border: "border-[hsl(265,89%,65%)]/20" },
  green: { bg: "bg-[hsl(142,76%,36%)]/10", text: "text-[hsl(142,76%,36%)]", border: "border-[hsl(142,76%,36%)]/20" },
  amber: { bg: "bg-[hsl(38,92%,50%)]/10", text: "text-[hsl(38,92%,50%)]", border: "border-[hsl(38,92%,50%)]/20" },
  red: { bg: "bg-[hsl(0,72%,51%)]/10", text: "text-[hsl(0,72%,51%)]", border: "border-[hsl(0,72%,51%)]/20" },
  cyan: { bg: "bg-[hsl(187,92%,69%)]/10", text: "text-[hsl(187,92%,69%)]", border: "border-[hsl(187,92%,69%)]/20" },
};

/* ─── animated counter ─── */
function Counter({ to, suffix = "" }) {
  const [val, setVal] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting && !started) setStarted(true); },
      { threshold: 0.5 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    let frame;
    const start = Date.now();
    const dur = 1400;
    const tick = () => {
      const p = Math.min((Date.now() - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * to));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [started, to]);

  return <span ref={ref}>{val}{suffix}</span>;
}

/* ─── main component ─── */
export default function Landing() {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  const [activeLayer, setActiveLayer] = useState(0);

  return (
    <div className="min-h-screen bg-[hsl(222,47%,6%)] text-[hsl(210,40%,98%)] overflow-x-hidden">

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 bg-[hsl(222,47%,6%)]/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(199,89%,48%)] to-[hsl(265,89%,65%)] flex items-center justify-center glow-blue">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold text-gradient-blue tracking-wide">DCT Protocol</span>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm text-[hsl(215,20%,55%)]">
          <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
          <a href="#sdk" className="hover:text-white transition-colors">SDK</a>
          <a href="#security" className="hover:text-white transition-colors">Security</a>
          <a href="#stack" className="hover:text-white transition-colors">Stack</a>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://sepolia.basescan.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 text-xs text-[hsl(215,20%,55%)] hover:text-white transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            BaseScan
          </a>
          <Link
            to="/live-demo"
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-[hsl(199,89%,48%)] text-[hsl(222,47%,6%)] hover:brightness-110 transition-all glow-blue"
          >
            Open App
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section ref={heroRef} className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 pt-20 overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-grid opacity-60 pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-[hsl(199,89%,48%)]/5 blur-[120px]" />
          <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] rounded-full bg-[hsl(265,89%,65%)]/5 blur-[100px]" />
          <div className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-[hsl(199,89%,48%)]/4 blur-[80px]" />
        </div>

        <motion.div style={{ y: heroY, opacity: heroOpacity }} className="relative z-10 max-w-4xl mx-auto">
          {/* Badge */}
          <motion.div {...fadeUp(0)} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[hsl(199,89%,48%)]/10 border border-[hsl(199,89%,48%)]/25 text-[hsl(199,89%,48%)] text-xs font-medium tracking-wide mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(199,89%,48%)] animate-pulse" />
            Live on Base Sepolia · All infrastructure deployed
          </motion.div>

          {/* Headline */}
          <motion.h1 {...fadeUp(0.08)} className="text-5xl sm:text-6xl md:text-7xl font-extrabold leading-[1.05] tracking-tight mb-6">
            <span className="text-gradient-blue">Delegated</span>
            <br />
            <span className="text-white">Capability Tokens</span>
          </motion.h1>

          {/* Sub-headline */}
          <motion.p {...fadeUp(0.16)} className="text-lg sm:text-xl text-[hsl(215,20%,65%)] max-w-2xl mx-auto leading-relaxed mb-4">
            Cryptographic authority delegation for autonomous multi-agent systems. Authority only narrows.
            Revocation cascades in O(1). No trusted intermediary.
          </motion.p>

          <motion.p {...fadeUp(0.22)} className="text-sm text-[hsl(215,20%,45%)] max-w-xl mx-auto leading-relaxed mb-10 font-mono">
            ERC-8004 gives agents identity · x402 gives payment rails · ERC-7710 gives delegation
            <br />
            <span className="text-[hsl(199,89%,48%)]">DCT gives verifiable, cascading, trust-aware authority.</span>
          </motion.p>

          {/* CTAs */}
          <motion.div {...fadeUp(0.28)} className="flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/live-demo"
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold bg-gradient-to-r from-[hsl(199,89%,48%)] to-[hsl(187,92%,69%)] text-[hsl(222,47%,6%)] hover:brightness-110 transition-all glow-blue-strong"
            >
              <Zap className="w-4 h-4" />
              Live Demo
            </Link>
            <Link
              to="/demo"
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold glass border-white/10 hover:bg-white/10 transition-all"
            >
              <Terminal className="w-4 h-4" />
              Quick Demo
            </Link>
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-[hsl(215,20%,40%)]"
        >
          <span className="text-xs tracking-widest uppercase">Scroll</span>
          <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}>
            <ChevronDown className="w-4 h-4" />
          </motion.div>
        </motion.div>
      </section>

      {/* ── Stats strip ── */}
      <section className="relative border-y border-white/5 bg-[hsl(222,47%,7%)]">
        <div className="max-w-5xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { label: "Delegation hops", value: 8, suffix: " max" },
            { label: "Gas for revoke", value: 1, suffix: " SSTORE" },
            { label: "Gas worst-case walk", value: 6400, suffix: " gas" },
            { label: "Attestation bytes", value: 65, suffix: " bytes" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-extrabold text-gradient-blue tabular-nums">
                <Counter to={s.value} suffix={s.suffix} />
              </div>
              <div className="mt-1 text-xs text-[hsl(215,20%,45%)] uppercase tracking-widest">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Problem ── */}
      <section className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div {...fadeUp()} className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-3">The Gap</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5">
              Every multi-agent framework<br />handles delegation incorrectly.
            </h2>
            <p className="text-[hsl(215,20%,55%)] max-w-2xl mx-auto">
              In CrewAI, AutoGen, MetaGPT and similar systems, when an orchestrator spawns a sub-agent,
              the child either inherits the parent's full credentials or gets its own independent key.
              No framework implements cryptographic scope narrowing.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-5 mb-12">
            {[
              { name: "CrewAI", issue: "Child inherits full orchestrator credentials" },
              { name: "AutoGen", issue: "Independent keys — no cryptographic link to parent" },
              { name: "MetaGPT", issue: "No cascade revocation — compromised child = full compromise" },
            ].map((f, i) => (
              <motion.div key={f.name} {...fadeUp(i * 0.08)} className="glass rounded-2xl p-6 border-red-500/10">
                <div className="flex items-start justify-between mb-3">
                  <span className="text-sm font-semibold text-white">{f.name}</span>
                  <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                </div>
                <p className="text-sm text-[hsl(215,20%,50%)] leading-relaxed">{f.issue}</p>
              </motion.div>
            ))}
          </div>

          {/* The gap diagram */}
          <motion.div {...fadeUp(0.2)} className="glass-strong rounded-2xl p-8 border-gradient">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(215,20%,45%)] mb-5 text-center">The missing primitive</p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm font-mono">
              {[
                { label: "ERC-8004", sub: "Identity", color: "blue" },
                { label: "+", sub: null, color: null },
                { label: "x402", sub: "Payments", color: "amber" },
                { label: "+", sub: null, color: null },
                { label: "ERC-7710", sub: "Delegation", color: "purple" },
                { label: "+", sub: null, color: null },
                { label: "???", sub: null, color: "red" },
                { label: "=", sub: null, color: null },
                { label: "Trustless multi-agent", sub: null, color: "green" },
              ].map((item, i) =>
                !item.sub && item.label !== "???" ? (
                  <span key={i} className="text-[hsl(215,20%,40%)] text-lg font-light">{item.label}</span>
                ) : (
                  <span
                    key={i}
                    className={`px-3 py-1.5 rounded-lg text-xs ${
                      item.color ? `${colorMap[item.color].bg} ${colorMap[item.color].text} border ${colorMap[item.color].border}` : ""
                    }`}
                  >
                    {item.label}
                    {item.sub && <span className="block text-[10px] opacity-60 font-sans">{item.sub}</span>}
                  </span>
                )
              )}
            </div>
            <div className="text-center mt-6">
              <span className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[hsl(199,89%,48%)]/15 border border-[hsl(199,89%,48%)]/30 text-[hsl(199,89%,48%)] text-sm font-semibold">
                <Shield className="w-4 h-4" />
                DCT fills the ???
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Architecture ── */}
      <section id="architecture" className="py-28 px-6 bg-[hsl(222,47%,7%)] border-y border-white/5">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp()} className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-3">Architecture</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Four interlocking layers</h2>
          </motion.div>

          {/* Layer selector tabs */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {LAYERS.map((l, i) => (
              <button
                key={l.number}
                onClick={() => setActiveLayer(i)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  activeLayer === i
                    ? `${colorMap[l.color].bg} ${colorMap[l.color].text} ${colorMap[l.color].border}`
                    : "border-white/5 text-[hsl(215,20%,50%)] hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="font-mono text-xs opacity-60 mr-1">{l.number}</span>
                {l.title}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {LAYERS.map((l, i) =>
              activeLayer !== i ? null : (
                <motion.div
                  key={l.number}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="grid md:grid-cols-2 gap-6 items-start"
                >
                  <div className={`glass-strong rounded-2xl p-8 ${l.glow} border-gradient`}>
                    <div className="flex items-center gap-3 mb-5">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: `${l.accent}20`, border: `1px solid ${l.accent}30` }}
                      >
                        <l.icon className="w-5 h-5" style={{ color: l.accent }} />
                      </div>
                      <div>
                        <p className="font-bold text-white">{l.title}</p>
                        <p className="text-xs text-[hsl(215,20%,50%)]">{l.subtitle}</p>
                      </div>
                      <span
                        className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-md"
                        style={{ background: `${l.accent}15`, color: l.accent }}
                      >
                        {l.tag}
                      </span>
                    </div>
                    <p className="text-sm text-[hsl(215,20%,65%)] leading-relaxed">{l.description}</p>
                  </div>

                  <div className="glass rounded-2xl overflow-hidden border border-white/5">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/2">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                      <span className="ml-2 text-[10px] text-[hsl(215,20%,40%)] font-mono">
                        {l.subtitle.toLowerCase().replace(/ /g, "-")}.sol
                      </span>
                    </div>
                    <pre className="p-5 text-xs font-mono leading-relaxed overflow-x-auto text-[hsl(215,20%,70%)] whitespace-pre">
                      <code>{l.code}</code>
                    </pre>
                  </div>
                </motion.div>
              )
            )}
          </AnimatePresence>

          {/* Layer flow diagram */}
          <motion.div {...fadeUp(0.2)} className="mt-12 flex flex-wrap items-center justify-center gap-3 text-xs text-[hsl(215,20%,50%)]">
            {["Eclipse Biscuit", "→", "DCTRegistry", "→", "DCTEnforcer", "→", "TLSNotary"].map((item, i) =>
              item === "→" ? (
                <ArrowRight key={i} className="w-4 h-4 text-[hsl(215,20%,30%)]" />
              ) : (
                <span key={i} className="px-3 py-1 rounded-lg bg-white/5 border border-white/8 font-mono">
                  {item}
                </span>
              )
            )}
          </motion.div>
        </div>
      </section>

      {/* ── SDK ── */}
      <section id="sdk" className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div {...fadeUp()} className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-3">SDK</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Three calls. That's it.</h2>
            <p className="text-[hsl(215,20%,55%)] max-w-xl mx-auto text-sm">
              DCT has no opinion on CrewAI vs LangGraph vs raw agents. Any agent runtime adopts it
              by adding three SDK calls.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {SDK_CALLS.map((s, i) => (
              <motion.div key={s.call} {...fadeUp(i * 0.1)} className="glass rounded-2xl p-6 flex flex-col gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorMap[s.color].bg} border ${colorMap[s.color].border}`}>
                  <s.icon className={`w-5 h-5 ${colorMap[s.color].text}`} />
                </div>
                <div>
                  <p className={`font-mono text-base font-bold ${colorMap[s.color].text}`}>{s.call}</p>
                  <p className="text-xs text-[hsl(215,20%,50%)] mt-1 leading-relaxed">{s.detail}</p>
                </div>
                <ul className="space-y-2">
                  {s.steps.map((step, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-[hsl(215,20%,60%)]">
                      <Check className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colorMap[s.color].text}`} />
                      {step}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>

          {/* Code snippet */}
          <motion.div {...fadeUp(0.3)} className="mt-10 glass rounded-2xl overflow-hidden border border-white/5">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-white/2">
              <Code2 className="w-4 h-4 text-[hsl(215,20%,40%)]" />
              <span className="text-[10px] font-mono text-[hsl(215,20%,40%)]">dct-sdk · TypeScript</span>
            </div>
            <pre className="p-6 text-xs font-mono leading-relaxed overflow-x-auto text-[hsl(215,20%,70%)]">
{`import { delegate, execute, revoke } from "@shaurya2k06/dctsdk";

// 1. Delegate — offline Biscuit attenuation + on-chain registration
const { childToken } = await delegate({
  parentTokenB64: rootToken,
  parentAgentTokenId: "42",
  childAgentTokenId:  "87",
  childTools:  ["web_fetch"],    // subset of parent's ["research", "web_fetch", "x402_pay"]
  childSpendLimit: 10_000_000,   // 10 USDC < parent's 50 USDC
});

// 2. Execute — two-layer enforcement
const result = await execute({
  tokenB64:     childToken,
  agentTokenId: "87",
  toolName:     "web_fetch",
  spendAmount:  0,
  tlsAttestation: proof, // 65-byte notary sig
});

// 3. Revoke — O(1) SSTORE, all descendants invalid at next execute
await revoke({ tokenB64: rootToken, agentTokenId: "42" });`}
            </pre>
          </motion.div>
        </div>
      </section>

      {/* ── Security ── */}
      <section id="security" className="py-28 px-6 bg-[hsl(222,47%,7%)] border-y border-white/5">
        <div className="max-w-5xl mx-auto">
          <motion.div {...fadeUp()} className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-3">Security</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Every attack vector addressed.</h2>
            <p className="text-[hsl(215,20%,55%)] max-w-xl mx-auto text-sm">
              Formal guarantees, not conventions. Each property is enforced cryptographically or at the EVM level.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-4">
            {SECURITY_ROWS.map((r, i) => (
              <motion.div
                key={r.attack}
                {...fadeUp(i * 0.07)}
                className="glass rounded-xl p-5 flex gap-4 group hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-[hsl(142,76%,36%)]/10 border border-[hsl(142,76%,36%)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Lock className="w-4 h-4 text-[hsl(142,76%,36%)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white mb-1">{r.attack}</p>
                  <p className="text-xs text-[hsl(215,20%,55%)] leading-relaxed">{r.why}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Design Principles ── */}
      <section className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div {...fadeUp()} className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-3">Design</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Built on four principles.</h2>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: GitBranch,
                title: "Authority only narrows",
                body: "Biscuit Datalog makes scope widening inexpressible. A cryptographic guarantee, not a convention.",
                color: "blue",
              },
              {
                icon: RefreshCw,
                title: "Lazy revocation",
                body: "One SSTORE kills the entire downstream tree. O(1) write, O(depth) check. No gas bomb.",
                color: "purple",
              },
              {
                icon: Shield,
                title: "No trusted intermediary",
                body: "No auth server. No oracle. No arbiter. The smart contract is the only judge.",
                color: "green",
              },
              {
                icon: Layers,
                title: "Composable",
                body: "DCT is a caveat enforcer inside ERC-7710. It adds the one thing the framework leaves to implementors.",
                color: "amber",
              },
            ].map((p, i) => (
              <motion.div key={p.title} {...fadeUp(i * 0.08)} className="glass rounded-2xl p-6 flex flex-col gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${colorMap[p.color].bg} border ${colorMap[p.color].border}`}>
                  <p.icon className={`w-4 h-4 ${colorMap[p.color].text}`} />
                </div>
                <p className="text-sm font-semibold text-white">{p.title}</p>
                <p className="text-xs text-[hsl(215,20%,55%)] leading-relaxed">{p.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section id="stack" className="py-28 px-6 bg-[hsl(222,47%,7%)] border-y border-white/5">
        <div className="max-w-4xl mx-auto">
          <motion.div {...fadeUp()} className="text-center mb-14">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-3">Stack</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">No proprietary components.</h2>
          </motion.div>

          <div className="flex flex-wrap justify-center gap-3">
            {STACK.map((s, i) => (
              <motion.div
                key={s.label}
                {...fadeIn(i * 0.04)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl glass border ${colorMap[s.color].border} hover:${colorMap[s.color].bg} transition-colors cursor-default`}
              >
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${colorMap[s.color].bg} ${colorMap[s.color].text}`}>
                  {s.tag}
                </span>
                <span className="text-sm text-[hsl(215,20%,75%)]">{s.label}</span>
              </motion.div>
            ))}
          </div>

          {/* Full table */}
          <motion.div {...fadeUp(0.2)} className="mt-12 glass rounded-2xl overflow-hidden border border-white/5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-5 py-3 text-[hsl(215,20%,45%)] font-medium uppercase tracking-wider">Layer</th>
                  <th className="text-left px-5 py-3 text-[hsl(215,20%,45%)] font-medium uppercase tracking-wider">Technology</th>
                  <th className="hidden sm:table-cell text-left px-5 py-3 text-[hsl(215,20%,45%)] font-medium uppercase tracking-wider">Install</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ["Off-chain token", "Eclipse Biscuit v3 (Apache 2.0)", "npm i @biscuit-auth/biscuit-wasm"],
                  ["Delegation enforcement", "ERC-7710 MetaMask Delegation Framework", "forge install metamask/delegation-framework"],
                  ["Action verification", "TLSNotary MPC-TLS (Rust)", "cargo add tlsn"],
                  ["Agent identity", "ERC-8004 (Draft, deployed)", "eips.ethereum.org/EIPS/eip-8004"],
                  ["Account abstraction", "ERC-4337 / Pimlico / permissionless.js", "npm i permissionless"],
                  ["Chain", "Base Sepolia → Base mainnet", "RPC: sepolia.base.org"],
                ].map(([layer, tech, install]) => (
                  <tr key={layer} className="hover:bg-white/2 transition-colors">
                    <td className="px-5 py-3 text-[hsl(215,20%,50%)]">{layer}</td>
                    <td className="px-5 py-3 text-[hsl(215,20%,75%)] font-medium">{tech}</td>
                    <td className="hidden sm:table-cell px-5 py-3 font-mono text-[hsl(199,89%,48%)]/70">{install}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </div>
      </section>

      {/* ── 5-minute demo ── */}
      <section className="py-28 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div {...fadeUp()} className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-3">Demo</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Five minutes. Five proofs.</h2>
          </motion.div>

          <div className="space-y-4">
            {[
              {
                min: "01",
                title: "Setup",
                desc: "Three agents registered on ERC-8004. Root creates a Biscuit authority token — WASM call completing in under 100ms. Empty delegation tree, baseline trust scores.",
                color: "blue",
              },
              {
                min: "02",
                title: "Delegation cascade",
                desc: "A attenuates offline — zero network traffic, instant. A→B→C. Each hop narrows scope. Three registerDelegation() transactions on BaseScan. Live tree with three nodes.",
                color: "purple",
              },
              {
                min: "03",
                title: "Successful execution",
                desc: "Agent C makes a real external API call. TLSNotary Rust prover generates MPC-TLS attestation. DCTEnforcer validates four things. Trust scores increment.",
                color: "green",
              },
              {
                min: "04",
                title: "Scope enforcement",
                desc: "C attempts a tool outside its scope — Datalog check fails off-chain, zero gas. C tries to exceed spend — DCTEnforcer reverts on-chain. Two enforcement layers.",
                color: "amber",
              },
              {
                min: "05",
                title: "Cascade revocation",
                desc: "Root calls revoke() — one SSTORE, O(1) gas. C submits the same call it just succeeded with. isRevoked() walks two ancestor hops, finds the flag, reverts.",
                color: "red",
              },
            ].map((step, i) => (
              <motion.div
                key={step.min}
                {...fadeUp(i * 0.07)}
                className="flex gap-5 glass rounded-2xl p-6 hover:bg-white/5 transition-colors"
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-mono text-sm font-bold ${colorMap[step.color].bg} ${colorMap[step.color].text} border ${colorMap[step.color].border}`}
                >
                  {step.min}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white mb-1">{step.title}</p>
                  <p className="text-xs text-[hsl(215,20%,55%)] leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-28 px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-[hsl(199,89%,48%)]/6 blur-[100px]" />
        </div>
        <div className="relative max-w-2xl mx-auto text-center">
          <motion.div {...fadeUp()}>
            <p className="text-xs uppercase tracking-[0.2em] text-[hsl(199,89%,48%)] mb-4">Get started</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-6 leading-tight">
              The delegation primitive<br />
              <span className="text-gradient-blue">every agent stack is missing.</span>
            </h2>
            <p className="text-[hsl(215,20%,55%)] mb-10 leading-relaxed">
              All infrastructure is live. All referenced contracts deployed on Base Sepolia.
              No whitelist. No waitlist. Three SDK calls.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                to="/live-demo"
                className="flex items-center gap-2 px-8 py-4 rounded-xl font-bold bg-gradient-to-r from-[hsl(199,89%,48%)] to-[hsl(187,92%,69%)] text-[hsl(222,47%,6%)] hover:brightness-110 transition-all text-sm glow-blue-strong"
              >
                <Zap className="w-4 h-4" />
                Open Live Demo
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="https://sepolia.basescan.org"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-8 py-4 rounded-xl font-semibold glass border-white/10 hover:bg-white/10 transition-all text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                BaseScan
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 px-6 py-10">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(199,89%,48%)] to-[hsl(265,89%,65%)] flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm text-gradient-blue font-bold">DCT Protocol</span>
            <span className="text-xs text-[hsl(215,20%,35%)]">v1.0 · April 2026</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-[hsl(215,20%,40%)]">
            <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">ERC-8004</a>
            <a href="https://eips.ethereum.org/EIPS/eip-7710" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">ERC-7710</a>
            <a href="https://tlsnotary.org" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">TLSNotary</a>
            <a href="https://doc.biscuitsec.org" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Biscuit</a>
          </div>
          <p className="text-xs text-[hsl(215,20%,30%)]">MIT Licensed · All infrastructure live</p>
        </div>
      </footer>
    </div>
  );
}
