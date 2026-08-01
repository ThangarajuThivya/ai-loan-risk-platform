/** Pill-style currency selector, shared across the customer/staff/admin currency views. */
export default function CurrencyPicker({ currencies, selected, onSelect, multi, className }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className || ""}`}>
      {currencies.map((c) => {
        const isActive = multi ? selected.includes(c.code) : selected === c.code;
        return (
          <button
            key={c.code}
            type="button"
            onClick={() => onSelect(c.code)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              isActive
                ? "bg-brand-primary text-white border-brand-primary shadow-sm"
                : "bg-white text-slate-600 border-slate-200 hover:border-brand-primary/40"
            }`}
          >
            {c.code}
            <span className="hidden sm:inline text-xs font-normal opacity-80"> · {c.name}</span>
          </button>
        );
      })}
    </div>
  );
}
