import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { Languages, ChevronDown } from "lucide-react";

const LANGUAGES = [
  { code: "en", short: "EN" },
  { code: "si", short: "සිං" },
  { code: "ta", short: "தமி" },
];

// Two visual variants: a floating dropdown (desktop nav) and an inline
// segmented control (mobile menu panel, where an absolute-positioned
// dropdown would be awkward inside an already-scrolling full-width panel).
export default function LanguageSwitcher({ variant = "dropdown" }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const current = LANGUAGES.find((l) => l.code === i18n.language) || LANGUAGES[0];

  const changeLanguage = (code) => {
    i18n.changeLanguage(code);
    setOpen(false);
  };

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-1.5" role="group" aria-label={t("languageSwitcher.label")}>
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => changeLanguage(lang.code)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              i18n.language === lang.code
                ? "bg-brand-accent text-white"
                : "bg-white/10 text-white/80 hover:bg-white/20"
            }`}
          >
            {t(`languageSwitcher.${lang.code}`)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-white/80 hover:text-white px-2.5 py-2 text-sm font-medium transition-colors cursor-pointer"
        aria-label={t("languageSwitcher.label")}
      >
        <Languages className="w-4 h-4" />
        <span>{current.short}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute right-0 mt-2 w-40 bg-white rounded-2xl border border-slate-100 shadow-xl z-50 p-2 space-y-1"
            >
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => changeLanguage(lang.code)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    i18n.language === lang.code
                      ? "bg-brand-primary/10 text-brand-primary"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{t(`languageSwitcher.${lang.code}`)}</span>
                  <span className="text-slate-400">{lang.short}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
