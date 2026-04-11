import { motion } from "framer-motion";

const colorMap = {
  blue: {
    bg: "bg-nb-accent-2/15",
    icon: "text-nb-accent-2",
    iconBg: "bg-nb-accent-2/20",
    border: "border-nb-accent-2",
  },
  green: {
    bg: "bg-nb-ok/15",
    icon: "text-nb-ok",
    iconBg: "bg-nb-ok/20",
    border: "border-nb-ok",
  },
  amber: {
    bg: "bg-nb-warn/15",
    icon: "text-nb-warn",
    iconBg: "bg-nb-warn/20",
    border: "border-nb-warn",
  },
  red: {
    bg: "bg-nb-error/15",
    icon: "text-nb-error",
    iconBg: "bg-nb-error/20",
    border: "border-nb-error",
  },
  purple: {
    bg: "bg-purple-500/15",
    icon: "text-purple-600",
    iconBg: "bg-purple-500/20",
    border: "border-purple-500",
  },
};

export default function StatCard({ icon: Icon, label, value, subtext, color = "blue", delay = 0 }) {
  const c = colorMap[color] || colorMap.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.1, duration: 0.4, ease: "easeOut" }}
      className="nb-card hover:-translate-y-1 active:translate-y-0 transition-transform duration-200 cursor-default"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-nb-ink/60 font-display font-semibold">{label}</p>
          <p className="text-3xl font-bold mt-2 tracking-tight font-display text-nb-ink">{value}</p>
          {subtext && (
            <p className="text-xs text-nb-ink/50 mt-1 font-body">{subtext}</p>
          )}
        </div>
        <div className={`w-12 h-12 rounded-nb border-2 border-nb-ink ${c.iconBg} flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${c.icon}`} />
        </div>
      </div>
    </motion.div>
  );
}
