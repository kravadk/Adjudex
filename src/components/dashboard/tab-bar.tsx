"use client";

// Reusable segmented tab bar (generalizes the inline market/limit toggle).
// Used to compact dense pages: one hero + a tab bar that swaps panes below it.

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  count?: number;
};

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1 overflow-x-auto no-scrollbar border-b ${className}`}
      style={{ borderColor: "var(--line-soft)" }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(tab.id)}
            className="relative inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-3 text-[13px] uppercase tracking-[0.06em] transition-colors"
            style={{ color: isActive ? "var(--tx)" : "var(--t3)", fontWeight: isActive ? 800 : 700 }}
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                style={{ background: "var(--card-inner)", color: "var(--t2)" }}
              >
                {tab.count}
              </span>
            )}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-3 -bottom-px h-[2px]"
                style={{ background: "#d9ff00" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
