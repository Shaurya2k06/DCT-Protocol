import { motion } from "framer-motion";

export default function StatCard({ icon: Icon, label, value, subtext, color = "blue", delay = 0 }) {
  const colorMap = {
    blue: {
      bg: "from-[hsl(199,89%,48%)]/10 to-[hsl(199,89%,48%)]/5",
      icon: "text-[hsl(199,89%,48%)]",
      iconBg: "bg-[hsl(199,89%,48%)]/10",
      glow: "glow-blue",
    },
    green: {
      bg: "from-[hsl(142,76%,36%)]/10 to-[hsl(142,76%,36%)]/5",
      icon: "text-[hsl(142,76%,36%)]",
      iconBg: "bg-[hsl(142,76%,36%)]/10",
      glow: "glow-green",
    },
    amber: {
      bg: "from-[hsl(38,92%,50%)]/10 to-[hsl(38,92%,50%)]/5",
      icon: "text-[hsl(38,92%,50%)]",
      iconBg: "bg-[hsl(38,92%,50%)]/10",
      glow: "glow-amber",
    },
    red: {
      bg: "from-[hsl(0,72%,51%)]/10 to-[hsl(0,72%,51%)]/5",
      icon: "text-[hsl(0,72%,51%)]",
      iconBg: "bg-[hsl(0,72%,51%)]/10",
      glow: "glow-red",
    },
    purple: {
      bg: "from-[hsl(265,89%,65%)]/10 to-[hsl(265,89%,65%)]/5",
      icon: "text-[hsl(265,89%,65%)]",
      iconBg: "bg-[hsl(265,89%,65%)]/10",
      glow: "glow-purple",
    },
  };

  const c = colorMap[color] || colorMap.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.1, duration: 0.5, ease: "easeOut" }}
      className={`glass rounded-2xl p-6 border-gradient ${c.glow} hover:scale-[1.02] transition-transform duration-300`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="text-3xl font-bold mt-2 tracking-tight">{value}</p>
          {subtext && (
            <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
          )}
        </div>
        <div className={`w-12 h-12 rounded-xl ${c.iconBg} flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${c.icon}`} />
        </div>
      </div>
    </motion.div>
  );
}
