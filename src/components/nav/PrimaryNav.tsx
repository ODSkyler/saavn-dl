import { motion } from 'framer-motion';

// Primary top-level navigation.
//   Desktop (>= sm): a compact segmented pill.
//   Mobile  (< sm):  a fixed bottom tab bar with icon + label per section.
// An animated indicator (Framer Motion layoutId) slides between the active
// section. Section count is dynamic (3–5) depending on enabled features.

interface NavProps {
  sections: string[];
  active: string;
  onSelect: (s: string) => void;
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function SectionIcon({ name, size = 20 }: { name: string; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case 'discover':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <polygon points="12 7 14.5 12 12 17 9.5 12" />
        </svg>
      );
    case 'library':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'playlists':
      return (
        <svg {...p}>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="13" y2="17" />
        </svg>
      );
    case 'history':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      );
    default:
      return null;
  }
}

const spring = { type: 'spring' as const, stiffness: 500, damping: 40 };

// ─── Desktop pill (>= sm) ─────────────────────────────────────────────────────

function DesktopPill({ sections, active, onSelect }: NavProps) {
  return (
    <div className="hidden sm:inline-flex flex-nowrap gap-1 rounded-xl border border-border bg-glass/50 p-1">
      {sections.map((s) => {
        const isActive = s === active;
        return (
          <button
            key={s}
            onClick={() => onSelect(s)}
            className={`relative px-5 py-1.5 rounded-lg text-[12px] font-display font-semibold capitalize whitespace-nowrap transition-colors duration-200 ${isActive ? 'text-cyan' : 'text-text-muted hover:text-text-secondary'
              }`}
          >
            {isActive && (
              <motion.span
                layoutId="navind-desktop"
                transition={spring}
                className="absolute inset-0 rounded-lg bg-cyan/15 border border-cyan/30"
              />
            )}
            <span className="relative z-10">{s}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Mobile bottom tab bar (< sm) ─────────────────────────────────────────────

function BottomBar({ sections, active, onSelect }: NavProps) {
  return (
    <nav
      className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch justify-around px-1 py-1.5">
        {sections.map((s) => {
          const isActive = s === active;
          return (
            <button
              key={s}
              onClick={() => onSelect(s)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-display font-semibold capitalize transition-colors duration-200 ${isActive ? 'text-cyan' : 'text-text-muted'
                }`}
            >
              {isActive && (
                <motion.span
                  layoutId="navind-bottom"
                  transition={spring}
                  className="absolute inset-x-2 inset-y-1 rounded-lg bg-cyan/10 border border-cyan/25"
                />
              )}
              <span className="relative z-10">
                <SectionIcon name={s} size={20} />
              </span>
              <span className="relative z-10">{s}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export default function PrimaryNav({ sections, active, onSelect }: NavProps) {
  return (
    <>
      <DesktopPill sections={sections} active={active} onSelect={onSelect} />
      <BottomBar sections={sections} active={active} onSelect={onSelect} />
    </>
  );
}
