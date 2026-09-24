interface TabItem<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  value: T;
  items: TabItem<T>[];
  onChange: (value: T) => void;
  className?: string;
  stretch?: boolean;
}

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className = "",
  stretch,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={`inline-flex gap-1 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/60 p-1 ${
        stretch ? "flex w-full" : ""
      } ${className}`}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${stretch ? "flex-1" : ""} ${
              active
                ? "dk-gradient text-white shadow"
                : "text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
