import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Car,
  Coins,
  FileText,
  KeyRound,
  Landmark,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Sparkles,
} from "lucide-react";

import api from "../api/axios";
import PhotoBackdrop from "../components/PhotoBackdrop";
import { IMAGES, NAVY_SCRIM } from "../utils/photoAssets";

/**
 * The public landing page.
 *
 * REWRITTEN because the previous version advertised a different product. It
 * described an American AI-underwriting platform — dollar figures
 * ($142,500 annual inflow, $8,450 monthly reserves), a `1099_FORM.pdf` (a US
 * tax form), "archaic FICO indices" (Sri Lanka uses CRIB), "military-grade
 * SOC2", a fake terminal reading `HUD_LIVE_DEEDS v1.19` — none of which this
 * system is or does. It also never once mentioned VEHICLE LEASING or
 * CURRENCY EXCHANGE, which together are most of the application.
 *
 * The replacement is built on one rule: EVERYTHING ON THIS PAGE IS TRUE AND
 * CHECKABLE. The rates are fetched live from the same catalogue endpoints the
 * apply forms use, so the homepage cannot drift from the product. The old
 * statistics counters ("12,450 processed decisions", "$140M evaluated") are
 * gone rather than restyled — they were invented, and inventing a lender's
 * track record is not a design decision.
 *
 * ON THE VISUAL LANGUAGE: the hero stays dark because Navbar.jsx renders
 * transparent-over-hero on this route only. An earlier pass filled it with a
 * generated SVG line pattern instead of a photo, on the reasoning that a
 * hotlinked image is one dependency away from a broken hero — true, but the
 * result read as placeholder art rather than a real bank. Photography wins
 * once it is actually chosen to match the product: a person signing on the
 * loans card, a car key on the leasing card, banknotes on the currency card,
 * not stock imagery picked at random.
 */

/* ------------------------------------------------------------------ *
 * Live catalogue
 * ------------------------------------------------------------------ */

const lkr = (n) =>
  `LKR ${Number(n || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

/**
 * The lowest rate a product can actually be priced at. Products opted into
 * risk-based pricing carry a band; the rest are flat. "from" rather than a
 * single figure is the honest phrasing either way — nobody is quoted a rate
 * before they are assessed.
 */
const rateFloor = (p) => Number(p.min_interest_rate ?? p.interest_rate ?? 0);

const fromRate = (p) => {
  const low = rateFloor(p);
  return low ? `${low.toFixed(2).replace(/\.00$/, "")}%` : null;
};

/**
 * Both catalogue endpoints are unauthenticated by design, so a visitor who
 * has never logged in still sees real numbers. Failures are swallowed to a
 * null board rather than an error state: a marketing page must render
 * without the API, and the sections around it stand on their own.
 */
function useCatalogue() {
  const [state, setState] = useState({ loans: [], leases: [], ready: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [l, v] = await Promise.all([
        api.get("/loans/products").catch(() => ({ data: { products: [] } })),
        api.get("/leases/products").catch(() => ({ data: { products: [] } })),
      ]);
      if (cancelled) return;
      setState({
        loans: l.data?.products || [],
        leases: v.data?.products || [],
        ready: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function Eyebrow({ children, tone = "dark" }) {
  return (
    <span
      className={`inline-block text-[11px] font-bold uppercase tracking-[0.2em] ${
        tone === "dark" ? "text-brand-accent" : "text-brand-secondary"
      }`}
    >
      {children}
    </span>
  );
}

/** A rate sheet row: name left, figure right, hairline between. */
function RateRow({ label, sub, value, note }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-white/10 last:border-0">
      <span className="min-w-0">
        <span className="block text-[13px] text-white/90 truncate">{label}</span>
        {sub && <span className="block text-[10px] text-white/40 mt-0.5">{sub}</span>}
      </span>
      <span className="text-right shrink-0">
        <span className="block font-mono text-sm font-semibold text-white tabular-nums">
          {value}
        </span>
        {note && <span className="block text-[10px] text-white/40">{note}</span>}
      </span>
    </div>
  );
}

/**
 * One product card, headed by a photo instead of a flat icon tile. `accent`
 * is a text-color class (e.g. "text-brand-accent") applied to the floating
 * icon badge; `image`/`imagePosition` pick the photo and its crop — see
 * IMAGES at the top of this file for provenance.
 *
 * `broken` tracks a failed image load. A hotlinked photo can fail in a way a
 * bundled asset cannot — the remote host having a bad day, not this app —
 * and the fallback is a plain brand-tinted panel rather than a broken-image
 * icon sitting above a loan product's rates.
 */
function ProductCard({ Icon, accent, eyebrow, title, body, facts, to, cta, image, imagePosition }) {
  const [broken, setBroken] = useState(false);

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="group relative flex flex-col bg-white rounded-2xl border border-slate-200/80 overflow-hidden hover:border-slate-300 hover:shadow-[0_12px_40px_-16px_rgba(15,76,129,0.28)] transition-all"
    >
      {/* The icon badge floats half on the photo, half on the white body
          below it — which means it has to live OUTSIDE the photo's own
          overflow-hidden. The photo crop needs that clip (it's what makes
          object-cover crop to a square instead of spilling past it); the
          badge doesn't want it, and nesting the badge inside that div was
          clipping its own bottom half clean off. This wrapper carries the
          badge as a sibling of the clipped photo box instead, so nothing
          downstream of the photo cuts it. */}
      <div className="relative shrink-0">
        {/* Square rather than the original short h-40 banner: that crop only
            showed ~27% of a portrait source photo's height, which was enough
            to lose the hand+pen entirely on the loans card and most of the
            hand+key on the leasing card. A square crop keeps 55-75% of the
            frame, which is the difference between "a sliver" and "the whole
            subject" for a photo where the subject sits in the middle third. */}
        <div className="relative aspect-square overflow-hidden bg-[#0F2338]">
          {!broken && (
            <img
              src={image}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="w-full h-full object-cover"
              style={{ objectPosition: imagePosition || "center", filter: "saturate(0.85)" }}
            />
          )}
          {/* Same navy scrim as the hero and leasing photos — this is the
              thing that makes a document, a car key and a pile of banknotes,
              shot by three different photographers, look like one brand. */}
          <div className="absolute inset-0" style={{ background: NAVY_SCRIM }} />
        </div>
        <span
          className={`absolute left-5 -bottom-[22px] w-11 h-11 rounded-xl bg-white shadow-md flex items-center justify-center ${accent}`}
        >
          <Icon className="w-5 h-5" />
        </span>
      </div>

      <div className="flex flex-col flex-1 p-6 sm:p-7 pt-8">
        <Eyebrow tone="light">{eyebrow}</Eyebrow>
        <h3 className="font-display font-bold text-xl text-slate-900 mt-2 mb-2.5 tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-slate-600 leading-relaxed">{body}</p>

        <dl className="mt-5 pt-5 border-t border-slate-100 space-y-2">
          {facts.map((f) => (
            <div key={f.k} className="flex justify-between gap-3 text-[12px]">
              <dt className="text-slate-500">{f.k}</dt>
              <dd className="font-mono font-semibold text-slate-900 tabular-nums text-right">
                {f.v}
              </dd>
            </div>
          ))}
        </dl>

        <Link
          to={to}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-brand-primary group-hover:gap-2.5 transition-all"
        >
          {cta}
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function Home() {
  const { t } = useTranslation();
  const { loans, leases, ready } = useCatalogue();

  // Cheapest first — a rate board that opens with the best number is the
  // convention. Sorted on the SAME figure that gets printed (the risk-banded
  // floor, not the headline rate), or the column reads out of order: a
  // product with a higher base rate can advertise a lower "from".
  const byRate = (a, b) => rateFloor(a) - rateFloor(b);
  const boardLoans = [...loans].filter((p) => p.active !== 0).sort(byRate).slice(0, 3);
  const boardLeases = [...leases].filter((p) => p.active !== 0).sort(byRate).slice(0, 2);

  const cheapestLoan = boardLoans[0];
  const cheapestLease = boardLeases[0];
  const biggestLoan = loans.reduce(
    (m, p) => (Number(p.max_amount) > Number(m?.max_amount || 0) ? p : m),
    null
  );

  const steps = [
    { Icon: FileText, k: "stepApply" },
    { Icon: Sparkles, k: "stepScore" },
    { Icon: ScrollText, k: "stepPolicy" },
    { Icon: UserCheck, k: "stepReview" },
    { Icon: Banknote, k: "stepOffer" },
  ];

  return (
    <div className="overflow-hidden bg-white">
      {/* ================= HERO ================= */}
      <section className="relative bg-[#071B2F] pt-32 pb-20 lg:pt-40 lg:pb-28">
        <PhotoBackdrop src={IMAGES.hero} position="center 30%" />
        {/* One warm sweep, low and wide, so the panel has something to sit on. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[520px]"
          style={{
            background:
              "radial-gradient(ellipse 70% 100% at 78% 18%, rgba(46,139,192,0.28), transparent 70%)",
          }}
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            {/* ---- Left: the claim ---- */}
            <div className="lg:col-span-7">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.18em] uppercase text-white/45"
              >
                <Landmark className="w-3.5 h-3.5 text-brand-accent" />
                <span>{t("home.locale")}</span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.06 }}
                className="mt-6 font-display font-bold text-white tracking-[-0.03em] leading-[1.02] text-[2.6rem] sm:text-6xl lg:text-[4.25rem]"
              >
                {t("home.heroLine1")}
                <br className="hidden sm:block" />{" "}
                <span className="relative inline-block text-brand-accent">
                  {t("home.heroLine2")}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 300 12"
                    preserveAspectRatio="none"
                    className="absolute left-0 -bottom-1 w-full h-2.5 text-brand-accent/45"
                  >
                    <path
                      d="M2 8 Q 75 2, 150 6 T 298 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.14 }}
                className="mt-7 text-base sm:text-[17px] text-white/65 leading-relaxed max-w-xl"
              >
                {t("home.heroSubtitle")}
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.22 }}
                className="mt-9 flex flex-col sm:flex-row gap-3"
              >
                <Link
                  to="/eligibility"
                  className="inline-flex items-center justify-center gap-2 bg-brand-accent hover:bg-[#019A62] text-white px-7 py-3.5 rounded-xl text-[15px] font-bold shadow-[0_10px_30px_-10px_rgba(0,168,107,0.7)] hover:shadow-[0_14px_38px_-10px_rgba(0,168,107,0.85)] hover:-translate-y-0.5 transition-all"
                >
                  {t("home.checkEligibility")}
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/services"
                  className="inline-flex items-center justify-center gap-2 text-white/90 hover:text-white border border-white/15 hover:border-white/30 hover:bg-white/[0.06] px-7 py-3.5 rounded-xl text-[15px] font-semibold transition-all"
                >
                  {t("home.exploreProducts")}
                </Link>
              </motion.div>

              {/* Three lines of business, named. The old page mentioned only
                  one of them. */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.34 }}
                className="mt-10 pt-8 border-t border-white/10 flex flex-wrap gap-x-8 gap-y-3"
              >
                {[
                  { Icon: Banknote, label: t("home.lineLoans") },
                  { Icon: Car, label: t("home.lineLeasing") },
                  { Icon: Coins, label: t("home.lineCurrency") },
                ].map(({ Icon, label }) => (
                  <span key={label} className="flex items-center gap-2 text-[13px] text-white/55">
                    <Icon className="w-4 h-4 text-brand-secondary" />
                    {label}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* ---- Right: the rate sheet, live ---- */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.18 }}
              className="lg:col-span-5"
            >
              <div className="rounded-2xl border border-white/12 bg-white/[0.04] backdrop-blur-sm overflow-hidden shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
                <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
                    {t("home.boardTitle")}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-mono text-brand-accent">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse" />
                    {t("home.boardLive")}
                  </span>
                </div>

                <div className="px-5 py-3">
                  {!ready && (
                    <div className="py-10 flex flex-col gap-2.5">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-4 rounded bg-white/5 animate-pulse" />
                      ))}
                    </div>
                  )}

                  {ready && boardLoans.length === 0 && boardLeases.length === 0 && (
                    <p className="py-10 text-center text-[12px] text-white/40">
                      {t("home.boardUnavailable")}
                    </p>
                  )}

                  {ready && boardLoans.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35 pt-1 pb-1.5">
                        {t("home.boardLoans")}
                      </p>
                      {boardLoans.map((p) => (
                        <RateRow
                          key={`l${p.id}`}
                          label={p.name}
                          sub={`${p.min_tenure_months}–${p.max_tenure_months} ${t("home.months")}`}
                          value={`${t("home.from")} ${fromRate(p) || "—"}`}
                          note={t("home.perAnnum")}
                        />
                      ))}
                    </>
                  )}

                  {ready && boardLeases.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35 pt-4 pb-1.5">
                        {t("home.boardLeasing")}
                      </p>
                      {boardLeases.map((p) => (
                        <RateRow
                          key={`v${p.id}`}
                          label={p.name}
                          sub={`${p.min_term_months}–${p.max_term_months} ${t("home.months")}`}
                          value={`${t("home.from")} ${fromRate(p) || "—"}`}
                          note={t("home.perAnnum")}
                        />
                      ))}
                    </>
                  )}
                </div>

                <p className="px-5 py-3.5 border-t border-white/10 text-[10.5px] leading-relaxed text-white/40">
                  {t("home.boardDisclaimer")}
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ================= THE THREE LINES ================= */}
      <section className="py-20 lg:py-24 bg-[#F8FAFC] border-b border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <Eyebrow tone="light">{t("home.productsEyebrow")}</Eyebrow>
            <h2 className="mt-3 font-display font-bold text-3xl sm:text-[2.6rem] leading-[1.1] text-slate-900 tracking-[-0.02em]">
              {t("home.productsTitle")}
            </h2>
            <p className="mt-4 text-[15px] text-slate-600 leading-relaxed">
              {t("home.productsIntro")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
            <ProductCard
              Icon={Banknote}
              accent="text-brand-primary"
              image={IMAGES.loans}
              imagePosition="center 55%"
              eyebrow={t("home.loansEyebrow")}
              title={t("home.loansTitle")}
              body={t("home.loansBody")}
              facts={[
                {
                  k: t("home.factFrom"),
                  v: cheapestLoan ? `${fromRate(cheapestLoan)} ${t("home.pa")}` : "—",
                },
                {
                  k: t("home.factUpTo"),
                  v: biggestLoan ? lkr(biggestLoan.max_amount) : "—",
                },
                { k: t("home.factProducts"), v: loans.filter((p) => p.active !== 0).length || "—" },
              ]}
              to="/services"
              cta={t("home.loansCta")}
            />

            <ProductCard
              Icon={Car}
              accent="text-brand-accent"
              image={IMAGES.leasing}
              imagePosition="center 38%"
              eyebrow={t("home.leaseEyebrow")}
              title={t("home.leaseTitle")}
              body={t("home.leaseBody")}
              facts={[
                {
                  k: t("home.factFrom"),
                  v: cheapestLease ? `${fromRate(cheapestLease)} ${t("home.pa")}` : "—",
                },
                { k: t("home.factTerm"), v: `12–60 ${t("home.months")}` },
                { k: t("home.factVehicles"), v: leases.length || "—" },
              ]}
              to="/services"
              cta={t("home.leaseCta")}
            />

            <ProductCard
              Icon={Coins}
              accent="text-brand-secondary"
              image={IMAGES.currency}
              imagePosition="center"
              eyebrow={t("home.fxEyebrow")}
              title={t("home.fxTitle")}
              body={t("home.fxBody")}
              facts={[
                { k: t("home.factPairs"), v: "USD · EUR · GBP · +" },
                { k: t("home.factSettles"), v: t("home.factSameDay") },
                { k: t("home.factRecords"), v: t("home.factReceipted") },
              ]}
              to="/services"
              cta={t("home.fxCta")}
            />
          </div>
        </div>
      </section>

      {/* ================= HOW A DECISION IS MADE ================= */}
      <section className="py-20 lg:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
            {/* Sticky so the heading tracks the steps instead of leaving a
                column of dead space beside the tail of the list. */}
            <div className="lg:col-span-5 lg:sticky lg:top-28 lg:self-start">
              <Eyebrow tone="light">{t("home.decisionEyebrow")}</Eyebrow>
              <h2 className="mt-3 font-display font-bold text-3xl sm:text-[2.6rem] leading-[1.1] text-slate-900 tracking-[-0.02em]">
                {t("home.decisionTitle")}
              </h2>
              <p className="mt-5 text-[15px] text-slate-600 leading-relaxed">
                {t("home.decisionIntro")}
              </p>

              <div className="mt-7 rounded-2xl bg-[#F8FAFC] border border-slate-200/70 p-5">
                <p className="flex items-start gap-2.5 text-[13px] text-slate-700 leading-relaxed">
                  <ShieldCheck className="w-4 h-4 text-brand-accent shrink-0 mt-0.5" />
                  <span>{t("home.decisionHuman")}</span>
                </p>
              </div>
            </div>

            {/* The real pipeline. Numbered, connected, five steps — the same
                five the backend actually runs. */}
            <div className="lg:col-span-7">
              <ol className="relative">
                {steps.map(({ Icon, k }, i) => (
                  <li key={k} className="relative flex gap-5 pb-8 last:pb-0">
                    {i < steps.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute left-[21px] top-11 bottom-0 w-px bg-slate-200"
                      />
                    )}
                    <span className="relative shrink-0 w-[42px] h-[42px] rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Icon className="w-[18px] h-[18px] text-brand-primary" />
                    </span>
                    <div className="pt-1.5 min-w-0">
                      <div className="flex items-baseline gap-2.5">
                        <span className="font-mono text-[11px] font-bold text-brand-accent tabular-nums">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <h3 className="font-display font-bold text-[17px] text-slate-900">
                          {t(`home.${k}Title`)}
                        </h3>
                      </div>
                      <p className="mt-1.5 text-[13.5px] text-slate-600 leading-relaxed">
                        {t(`home.${k}Desc`)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ================= LEASING SPOTLIGHT ================= */}
      <section className="relative py-20 lg:py-24 bg-[#071B2F] overflow-hidden">
        {/* A full-bleed crop of this photo (as this section originally had)
            put a wide/short window over a TALL portrait source — the hand
            and key sat in the middle third of a frame far taller than it is
            wide, so a banner-shaped crop could only ever show a thin slice
            of it and reliably cut through the one thing the photo is for.
            Framed at its own proportions instead, in the grid below, so the
            whole subject is guaranteed to be in shot rather than a gamble on
            the right object-position percentage. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[420px]"
          style={{
            background:
              "radial-gradient(ellipse 70% 100% at 85% 10%, rgba(46,139,192,0.22), transparent 70%)",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
            <div className="lg:col-span-5">
              <Eyebrow>{t("home.leaseSpotEyebrow")}</Eyebrow>
              <h2 className="mt-3 font-display font-bold text-3xl sm:text-[2.6rem] leading-[1.1] text-white tracking-[-0.02em]">
                {t("home.leaseSpotTitle")}
              </h2>
              <p className="mt-5 text-[15px] text-white/60 leading-relaxed">
                {t("home.leaseSpotBody")}
              </p>
              <Link
                to="/services"
                className="mt-7 inline-flex items-center gap-2 text-[15px] font-bold text-brand-accent hover:gap-3 transition-all"
              >
                {t("home.leaseSpotCta")}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* The photo, framed at close to its native aspect ratio
                  (3:4 against a native ~0.56) rather than forced into a
                  banner shape — the fix for "hand and key not fully
                  visible": there is no crop percentage that fits a subject
                  occupying the middle third of a portrait photo into a
                  panoramic window, only a wide enough window. */}
              <div className="relative rounded-2xl overflow-hidden border border-white/12 aspect-[3/4]">
                <img
                  src={IMAGES.leasing}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                  style={{ objectPosition: "center 38%", filter: "saturate(0.9)" }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(180deg, transparent 55%, rgba(7,27,47,0.55) 100%)",
                  }}
                />
              </div>

              {/* The title journey — the one thing that genuinely separates a
                  finance lease from a car loan, and the reason this module
                  exists as its own product rather than a loan variant. */}
              <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-6 sm:p-7">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/40 mb-5">
                  {t("home.titleJourney")}
                </p>
                <div className="space-y-4">
                  {[
                    { Icon: KeyRound, k: "titleStart" },
                    { Icon: Car, k: "titleDuring" },
                    { Icon: ScrollText, k: "titleEnd" },
                  ].map(({ Icon, k }) => (
                    <div key={k} className="flex gap-3.5">
                      <span className="shrink-0 w-9 h-9 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-brand-secondary" />
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-[13px] font-bold text-white">
                          {t(`home.${k}Title`)}
                        </p>
                        <p className="text-[12.5px] text-white/50 leading-relaxed mt-0.5">
                          {t(`home.${k}Desc`)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= LANGUAGE ================= */}
      <section className="py-20 lg:py-24 bg-[#F8FAFC] border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5">
              <Eyebrow tone="light">{t("home.langEyebrow")}</Eyebrow>
              <h2 className="mt-3 font-display font-bold text-3xl sm:text-[2.6rem] leading-[1.1] text-slate-900 tracking-[-0.02em]">
                {t("home.langTitle")}
              </h2>
              <p className="mt-5 text-[15px] text-slate-600 leading-relaxed">
                {t("home.langBody")}
              </p>
            </div>

            {/* Set in the actual scripts. A claim about language support is
                worth nothing typeset in English. */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { tag: "සිංහල", line: "ණය සහ කල්බදු", sub: "Sinhala" },
                { tag: "தமிழ்", line: "கடன் மற்றும் குத்தகை", sub: "Tamil" },
                { tag: "English", line: "Loans and leasing", sub: "English" },
              ].map((l) => (
                <div
                  key={l.sub}
                  className="bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-brand-secondary/40 transition-colors"
                >
                  <p className="font-display font-bold text-2xl text-slate-900 leading-tight">
                    {l.tag}
                  </p>
                  <p className="text-[13px] text-slate-600 mt-2 leading-snug">{l.line}</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mt-3">
                    {l.sub}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="py-20 lg:py-24 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-3xl bg-[#071B2F] px-6 py-14 sm:px-14 sm:py-16 overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 60% 120% at 100% 0%, rgba(0,168,107,0.22), transparent 65%)",
              }}
            />
            <div className="relative text-center max-w-2xl mx-auto">
              <h2 className="font-display font-bold text-[1.9rem] sm:text-[2.6rem] leading-[1.1] text-white tracking-[-0.02em]">
                {t("home.ctaTitle")}
              </h2>
              <p className="mt-4 text-[15px] text-white/60 leading-relaxed">
                {t("home.ctaSubtitle")}
              </p>
              <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  to="/eligibility"
                  className="inline-flex items-center justify-center gap-2 bg-brand-accent hover:bg-[#019A62] text-white px-7 py-3.5 rounded-xl text-[15px] font-bold shadow-[0_10px_30px_-10px_rgba(0,168,107,0.7)] hover:-translate-y-0.5 transition-all"
                >
                  {t("home.applyNow")}
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/emi-calculator"
                  className="inline-flex items-center justify-center gap-2 text-white/90 hover:text-white border border-white/15 hover:border-white/30 hover:bg-white/[0.06] px-7 py-3.5 rounded-xl text-[15px] font-semibold transition-all"
                >
                  {t("home.tryEmiCalculator")}
                </Link>
              </div>
              <p className="mt-6 text-[12px] text-white/35">{t("home.ctaFootnote")}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
