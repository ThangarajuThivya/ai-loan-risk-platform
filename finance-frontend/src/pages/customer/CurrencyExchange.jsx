import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeftRight,
  ArrowLeft,
  ArrowRight,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  ListChecks,
  Info,
  ShieldCheck,
  Boxes,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import CurrencyPicker from "../../components/currency/CurrencyPicker";
import RateBoardTable from "../../components/currency/RateBoardTable";
import QuoteLockTimer from "../../components/currency/QuoteLockTimer";
import { PURPOSE_CODE_OPTIONS, DIRECTION_META } from "../../constants/fxExchange";

const STEP_META = [
  { titleKey: "customer.currencyExchange.step0Title", subtitleKey: "customer.currencyExchange.step0Subtitle" },
  { titleKey: "customer.currencyExchange.step1Title", subtitleKey: "customer.currencyExchange.step1Subtitle" },
  { titleKey: "customer.currencyExchange.step2Title", subtitleKey: "customer.currencyExchange.step2Subtitle" },
];

const QUOTE_DEBOUNCE_MS = 350;

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayDateString = () => new Date().toISOString().slice(0, 10);

function estimateFromBoard(board, currencyCode, direction, amountMode, amount) {
  const row = board?.rates?.find((r) => r.currency === currencyCode);
  const amt = Number(amount);
  if (!row || !amt || amt <= 0) return null;
  const rate = direction === "buy" ? row.sell_rate : row.buy_rate;
  if (amountMode === "lkr") {
    return { rate, foreignAmount: Math.round((amt / rate) * 100) / 100 };
  }
  return { rate, lkrAmount: Math.round(amt * rate * 100) / 100 };
}

export default function CurrencyExchange() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [board, setBoard] = useState(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState("");

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState("buy");
  const [currencyCode, setCurrencyCode] = useState("");
  // Which side of the trade the customer is entering an amount for — the
  // foreign currency itself, or the LKR they have to spend/expect to
  // receive. Only the active field drives quoting; POST /quote accepts
  // exactly one of foreign_amount / lkr_amount and inverts server-side.
  const [amountMode, setAmountMode] = useState("foreign");
  const [foreignAmount, setForeignAmount] = useState("");
  const [lkrAmount, setLkrAmount] = useState("");

  const [quote, setQuote] = useState(null);
  const [quoteParams, setQuoteParams] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [requoting, setRequoting] = useState(false);

  const [purposeCode, setPurposeCode] = useState("");
  const [branch, setBranch] = useState("");
  const [settlementDate, setSettlementDate] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successData, setSuccessData] = useState(null);

  const seqRef = useRef(0);

  // Live rate board — sourced once; also doubles as the "which currencies
  // are tradable" client-side check (GET /board already filters to
  // is_tradable, matching the server's own submission-time re-check).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/currency/board");
        if (cancelled) return;
        setBoard(res.data);
        if (res.data?.rates?.length > 0) setCurrencyCode(res.data.rates[0].currency);
      } catch (err) {
        if (!cancelled) {
          setBoardError(
            err.response?.data?.message || t("customer.currencyExchange.boardErrorDefault")
          );
        }
      } finally {
        if (!cancelled) setBoardLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const activeAmount = amountMode === "lkr" ? lkrAmount : foreignAmount;

  const requestQuote = async ({ signal } = {}) => {
    const body = { direction, currency_code: currencyCode };
    if (amountMode === "lkr") body.lkr_amount = Number(lkrAmount);
    else body.foreign_amount = Number(foreignAmount);
    const res = await api.post("/currency/exchange/quote", body, { signal });
    return res.data;
  };

  // Debounced live quote — mirrors the EMI calculator's debounce pattern.
  // Each fetch is a fresh signed quote (CURRENCY_FEATURE.md §12.3); an
  // in-flight request is cancelled if the inputs change again before it
  // resolves, so a fast typist never has a stale response overwrite a
  // newer one.
  useEffect(() => {
    const mySeq = ++seqRef.current;
    const controller = new AbortController();
    let timer;

    (async () => {
      if (!currencyCode || !activeAmount || Number(activeAmount) <= 0) {
        setQuote(null);
        setQuoteParams(null);
        setQuoteError("");
        return;
      }

      await new Promise((resolve) => {
        timer = setTimeout(resolve, QUOTE_DEBOUNCE_MS);
      });
      if (controller.signal.aborted) return;

      setQuoting(true);
      setQuoteError("");
      try {
        const data = await requestQuote({ signal: controller.signal });
        if (seqRef.current === mySeq) {
          setQuote(data);
          setQuoteParams({ direction, currencyCode, amountMode, amount: activeAmount });
          setQuoteExpired(false);
        }
      } catch (err) {
        if (err.code !== "ERR_CANCELED" && seqRef.current === mySeq) {
          setQuote(null);
          setQuoteParams(null);
          setQuoteError(err.response?.data?.message || t("customer.currencyExchange.quoteErrorDefault"));
        }
      } finally {
        if (seqRef.current === mySeq) setQuoting(false);
      }
    })();

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, currencyCode, amountMode, activeAmount]);

  const handleRequote = async () => {
    if (!currencyCode || !activeAmount) return;
    setRequoting(true);
    setQuoteError("");
    try {
      const data = await requestQuote();
      setQuote(data);
      setQuoteParams({ direction, currencyCode, amountMode, amount: activeAmount });
      setQuoteExpired(false);
    } catch (err) {
      setQuoteError(err.response?.data?.message || t("customer.currencyExchange.requoteErrorDefault"));
    } finally {
      setRequoting(false);
    }
  };

  // Compared against the params a quote was actually requested with, not
  // re-derived from the response — when lkr_amount drives the quote, the
  // server rounds the derived foreign amount to 2dp and recomputes the LKR
  // total from that, so quote.quoted_lkr_amount can legitimately differ
  // from the LKR figure the customer typed by a rounding remainder.
  const quoteMatchesInputs =
    quote &&
    quoteParams &&
    quoteParams.direction === direction &&
    quoteParams.currencyCode === currencyCode &&
    quoteParams.amountMode === amountMode &&
    Number(quoteParams.amount) === Number(activeAmount);

  const quoteReady = Boolean(quoteMatchesInputs && !quoteExpired);
  const estimate = useMemo(
    () => estimateFromBoard(board, currencyCode, direction, amountMode, activeAmount),
    [board, currencyCode, direction, amountMode, activeAmount]
  );

  const tradableCurrencies = (board?.rates || []).map((r) => ({ code: r.currency, name: r.name }));

  // Client-side headroom check, display-only — mirrors the limits
  // fxExchange.controller.js's submitRequest re-checks server-side, which
  // remains the actual enforcement (a second in-flight request from
  // another tab could still consume the daily allowance in between).
  const overLimit = Boolean(
    quoteReady &&
      (quote.quoted_lkr_amount > quote.max_per_transaction_lkr ||
        quote.quoted_lkr_amount > quote.remaining_today_lkr)
  );

  const step0Valid = Boolean(
    currencyCode && Number(activeAmount) > 0 && quoteReady && !quoting && !overLimit
  );
  const step1Valid = Boolean(
    purposeCode && branch.trim().length > 0 && settlementDate && settlementDate >= todayDateString() && !quoteExpired
  );

  const goNext = () => setStep((s) => Math.min(s + 1, STEP_META.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const resetFlow = () => {
    setStep(0);
    setDirection("buy");
    setAmountMode("foreign");
    setForeignAmount("");
    setLkrAmount("");
    setQuote(null);
    setQuoteParams(null);
    setQuoteError("");
    setQuoteExpired(false);
    setPurposeCode("");
    setBranch("");
    setSettlementDate("");
    setSubmitError("");
    setSuccessData(null);
  };

  const handleSubmit = async () => {
    if (submitting || !quoteReady) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await api.post("/currency/exchange/requests", {
        quote_id: quote.quote_id,
        purpose_code: purposeCode,
        branch: branch.trim(),
        settlement_date: settlementDate,
      });
      setSuccessData(res.data);
      showToast({
        type: "success",
        title: t("customer.currencyExchange.submittedToastTitle"),
        message: t("customer.currencyExchange.submittedToastMessage", { ref: res.data.reference_no }),
      });
    } catch (err) {
      const message =
        err.response?.data?.message || t("customer.currencyExchange.submissionFailedDefault");
      setSubmitError(message);
      showToast({ type: "error", title: t("customer.currencyExchange.submissionFailedTitle"), message });
      if (err.response?.status === 410) setQuoteExpired(true);
    } finally {
      setSubmitting(false);
    }
  };

  const purposeLabel = PURPOSE_CODE_OPTIONS.find((p) => p.value === purposeCode)?.label;

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
              <ArrowLeftRight className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{t("customer.currencyExchange.pageEyebrow")}</p>
              <h1 className="text-sm font-bold text-slate-800">{t("customer.currencyExchange.pageTitle")}</h1>
            </div>
          </div>
          <Link
            to="/dashboard/currency/exchange/requests"
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline"
          >
            <ListChecks className="w-3.5 h-3.5" />
            {t("customer.currencyExchange.myRequests")}
          </Link>
        </div>

        {boardLoading && (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!boardLoading && boardError && (
          <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{boardError}</span>
          </div>
        )}

        {!boardLoading && !boardError && tradableCurrencies.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 text-center text-xs text-slate-400">
            {t("customer.currencyExchange.noCurrenciesTradable")}
          </div>
        )}

        {!boardLoading && !boardError && tradableCurrencies.length > 0 && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100">
            {!successData && (
              <>
                {/* Progress */}
                <div className="mb-8">
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-primary">
                      {t("customer.currencyExchange.stepOf", { current: step + 1, total: STEP_META.length })}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {Math.round(((step + 1) / STEP_META.length) * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-brand-primary"
                      initial={false}
                      animate={{ width: `${((step + 1) / STEP_META.length) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h2 className="font-display font-bold text-lg text-slate-900">{t(STEP_META[step].titleKey)}</h2>
                    <p className="text-xs text-slate-400 mt-1 mb-6">{t(STEP_META[step].subtitleKey)}</p>

                    {/* Step 0 — direction, currency, amount */}
                    {step === 0 && (
                      <div className="space-y-6">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-2">{t("customer.currencyExchange.directionLabel")}</label>
                          <div className="flex gap-2">
                            {Object.entries(DIRECTION_META).map(([key, meta]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setDirection(key)}
                                className={`flex-1 px-4 py-3 rounded-xl text-xs font-semibold border transition-colors text-left ${
                                  direction === key
                                    ? "bg-brand-primary text-white border-brand-primary"
                                    : "bg-white text-slate-600 border-slate-200 hover:border-brand-primary"
                                }`}
                              >
                                <span className="block">{meta.label}</span>
                                <span
                                  className={`block font-normal mt-0.5 text-[10px] ${
                                    direction === key ? "text-white/80" : "text-slate-400"
                                  }`}
                                >
                                  {meta.hint}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-2">{t("customer.currencyExchange.currencyLabel")}</label>
                          <CurrencyPicker
                            currencies={tradableCurrencies}
                            selected={currencyCode}
                            onSelect={(code) => setCurrencyCode(code)}
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-semibold text-slate-700">
                              {amountMode === "lkr"
                                ? t("customer.currencyExchange.amountLkrLabel")
                                : t("customer.currencyExchange.amountLabel", { code: currencyCode || "—" })}
                            </label>
                            <button
                              type="button"
                              onClick={() => setAmountMode((m) => (m === "lkr" ? "foreign" : "lkr"))}
                              className="text-[11px] font-semibold text-brand-primary hover:underline"
                            >
                              {amountMode === "lkr"
                                ? t("customer.currencyExchange.switchToForeignAmount", { code: currencyCode || "—" })
                                : t("customer.currencyExchange.switchToLkrAmount")}
                            </button>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={
                              amountMode === "lkr"
                                ? t("customer.currencyExchange.amountPlaceholderLkr")
                                : t("customer.currencyExchange.amountPlaceholderForeign")
                            }
                            value={amountMode === "lkr" ? lkrAmount : foreignAmount}
                            onChange={(e) =>
                              amountMode === "lkr" ? setLkrAmount(e.target.value) : setForeignAmount(e.target.value)
                            }
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary font-mono"
                          />

                          <div className="mt-3 bg-slate-50 rounded-xl border border-slate-100 p-4">
                            {!estimate && (
                              <p className="text-xs text-slate-400">{t("customer.currencyExchange.enterAmountHint")}</p>
                            )}
                            {estimate && (
                              <>
                                <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1">
                                  {amountMode === "lkr"
                                    ? t("customer.currencyExchange.indicativeForeignAmount", { code: currencyCode })
                                    : t("customer.currencyExchange.indicativeAmount")}
                                </p>
                                <p className="text-2xl font-display font-bold text-slate-900 font-mono flex items-center gap-2">
                                  {amountMode === "lkr"
                                    ? `${formatRate(quoteReady ? quote.foreign_amount : estimate.foreignAmount)} ${currencyCode}`
                                    : formatLkr(quoteReady ? quote.quoted_lkr_amount : estimate.lkrAmount)}
                                  {(quoting || (!quoteReady && !quoteError)) && (
                                    <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
                                  )}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-1">
                                  {t("customer.currencyExchange.ratePerUnit", {
                                    rate: formatRate(quoteReady ? quote.quoted_rate : estimate.rate),
                                    code: currencyCode,
                                  })}
                                  {!quoteReady && t("customer.currencyExchange.estimatedRateSuffix")}
                                </p>
                              </>
                            )}
                            {quoteError && (
                              <p className="text-xs text-rose-600 mt-2 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                {quoteError}
                              </p>
                            )}
                          </div>

                          {quoteReady && (
                            <div
                              className={`mt-3 rounded-xl border p-4 text-xs ${
                                overLimit
                                  ? "bg-rose-50 border-rose-100 text-rose-700"
                                  : "bg-slate-50 border-slate-100 text-slate-600"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span>{t("customer.currencyExchange.perTransactionLimit")}</span>
                                <span className="font-mono font-semibold">
                                  {formatLkr(quote.max_per_transaction_lkr)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between mt-1">
                                <span>{t("customer.currencyExchange.remainingToday")}</span>
                                <span className="font-mono font-semibold">
                                  {formatLkr(quote.remaining_today_lkr)}
                                </span>
                              </div>
                              {overLimit && (
                                <p className="mt-2 flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  {t("customer.currencyExchange.overLimitWarning")}
                                </p>
                              )}
                              {/* Advisory stock line — 'buy' only; the server
                                  sends null for 'sell', where the vault level
                                  is irrelevant. Never gates the Next button:
                                  the real check happens at staff approval. */}
                              {quote.available_amount !== null &&
                                quote.available_amount !== undefined && (
                                  <div className="flex items-center justify-between mt-1">
                                    <span>{t("customer.currencyExchange.availableStock")}</span>
                                    <span className="font-mono font-semibold">
                                      {Number(quote.available_amount).toLocaleString("en-LK", {
                                        maximumFractionDigits: 2,
                                      })}{" "}
                                      {quote.currency_code}
                                    </span>
                                  </div>
                                )}
                              {!overLimit && quote.sufficient_stock === false && (
                                <p className="mt-2 flex items-start gap-1.5 text-amber-700">
                                  <Boxes className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  {t("customer.currencyExchange.mayNeedOrderingIn")}
                                </p>
                              )}
                              {!overLimit && quote.will_require_documents && (
                                <p className="mt-2 flex items-start gap-1.5 text-amber-700">
                                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  {t("customer.currencyExchange.documentsRequiredNotice", {
                                    threshold: formatLkr(quote.document_threshold_lkr),
                                  })}
                                </p>
                              )}
                            </div>
                          )}

                          {quoteReady && (
                            <QuoteLockTimer
                              quote={quote}
                              onExpire={() => setQuoteExpired(true)}
                              onRequote={handleRequote}
                              requoting={requoting}
                              className="mt-3"
                            />
                          )}
                        </div>

                        {/* ExchangeForecastPanel removed in v3. It existed to
                            surface the LSTM 30-day projection as background
                            context; customers no longer receive forecasts
                            (see currency.controller.js simplifyForCustomer),
                            which left it showing only the model's last
                            *historical* observed USD/LKR rate directly above
                            the live rate board — two different numbers for
                            the same pair, which is worse than showing
                            nothing. Staff keep forecast context via
                            FxDecisionSupportPanel in the review queue. */}

                        <RateBoardTable
                          board={board}
                          highlightCurrency={currencyCode}
                          highlightDirection={direction}
                        />
                      </div>
                    )}

                    {/* Step 1 — purpose, branch, settlement date */}
                    {step === 1 && (
                      <div className="space-y-5">
                        <QuoteLockTimer
                          quote={quote}
                          onExpire={() => setQuoteExpired(true)}
                          onRequote={handleRequote}
                          requoting={requoting}
                        />

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            {t("customer.currencyExchange.purposeOfExchangeLabel")}
                          </label>
                          <select
                            value={purposeCode}
                            onChange={(e) => setPurposeCode(e.target.value)}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white"
                          >
                            <option value="">{t("customer.currencyExchange.selectPurposePlaceholder")}</option>
                            {PURPOSE_CODE_OPTIONS.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t("customer.currencyExchange.branchLabel")}</label>
                          <input
                            type="text"
                            maxLength={100}
                            placeholder={t("customer.currencyExchange.branchPlaceholder")}
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            {t("customer.currencyExchange.settlementDateLabel")}
                          </label>
                          <input
                            type="date"
                            min={todayDateString()}
                            value={settlementDate}
                            onChange={(e) => setSettlementDate(e.target.value)}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                          />
                          <p className="text-[11px] text-slate-400 mt-1.5">
                            {t("customer.currencyExchange.settlementDateHint")}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Step 2 — review */}
                    {step === 2 && (
                      <div className="space-y-5">
                        <QuoteLockTimer
                          quote={quote}
                          onExpire={() => setQuoteExpired(true)}
                          onRequote={handleRequote}
                          requoting={requoting}
                        />

                        <div className="space-y-2">
                          {[
                            { label: t("customer.currencyExchange.directionLabel"), value: DIRECTION_META[direction]?.label, step: 0 },
                            { label: t("customer.currencyExchange.currencyLabel"), value: currencyCode, step: 0 },
                            {
                              label: t("customer.currencyExchange.reviewForeignAmount"),
                              value: quote ? `${quote.foreign_amount} ${currencyCode}` : "—",
                              step: 0,
                            },
                            {
                              label: t("customer.currencyExchange.reviewExactRate"),
                              value: quote ? `${formatRate(quote.quoted_rate)} LKR / ${currencyCode}` : "—",
                              step: 0,
                            },
                            {
                              label: t("customer.currencyExchange.reviewSpreadApplied"),
                              value: quote ? `${(quote.spread_bps_applied / 100).toFixed(2)}%` : "—",
                              step: 0,
                            },
                            {
                              label: t("customer.currencyExchange.reviewFinalLkr"),
                              value: quote ? formatLkr(quote.quoted_lkr_amount) : "—",
                              step: 0,
                              emphasize: true,
                            },
                            { label: t("customer.currencyExchange.reviewPurpose"), value: purposeLabel, step: 1 },
                            { label: t("customer.currencyExchange.branchLabel"), value: branch, step: 1 },
                            { label: t("customer.currencyExchange.reviewSettlementDate"), value: settlementDate, step: 1 },
                          ].map((row) => (
                            <div
                              key={row.label}
                              className={`flex items-center justify-between py-2.5 px-3 rounded-lg ${
                                row.emphasize ? "bg-brand-primary/5 border border-brand-primary/10" : "odd:bg-slate-50"
                              }`}
                            >
                              <span className="text-xs text-slate-500">{row.label}</span>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs font-semibold text-right ${
                                    row.emphasize ? "text-brand-primary text-sm" : "text-slate-800"
                                  }`}
                                >
                                  {row.value || "—"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setStep(row.step)}
                                  className="text-slate-300 hover:text-brand-primary transition-colors"
                                  aria-label={t("customer.currencyExchange.editAriaLabel", { label: row.label })}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-start space-x-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-4 text-xs leading-relaxed">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{t("customer.currencyExchange.requestDisclaimer")}</span>
                        </div>

                        {submitError && (
                          <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 text-xs">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{submitError}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Nav buttons */}
                <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={step === 0}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-0 disabled:pointer-events-none transition-colors flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    {t("common.back")}
                  </button>

                  {step < STEP_META.length - 1 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={step === 0 ? !step0Valid : !step1Valid}
                      className="px-6 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                    >
                      {t("common.next")}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={submitting || !quoteReady}
                      className="px-6 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                    >
                      {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      {submitting
                        ? t("customer.currencyExchange.submitting")
                        : t("customer.currencyExchange.submitRequest")}
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Success state */}
            {successData && (
              <div className="flex flex-col items-center text-center py-8">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="font-display font-bold text-xl text-slate-900 mb-1">
                  {t("customer.currencyExchange.requestSubmittedTitle")}
                </h3>
                <p className="text-slate-500 text-sm max-w-sm mb-4">
                  {t("customer.currencyExchange.requestSubmittedMessage")}
                </p>
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-6 py-4 mb-6">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1">
                    {t("customer.currencyExchange.referenceNumber")}
                  </p>
                  <p className="text-2xl font-mono font-bold text-slate-900">{successData.reference_no}</p>
                </div>

                {successData.requires_documents && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-4 text-xs leading-relaxed text-left mb-6 max-w-sm">
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{t("customer.currencyExchange.documentsRequiredAfterSubmit")}</span>
                  </div>
                )}
                <div className="flex gap-3 w-full max-w-sm">
                  <button
                    type="button"
                    onClick={resetFlow}
                    className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-200 transition-colors text-sm"
                  >
                    {t("customer.currencyExchange.newExchange")}
                  </button>
                  <Link
                    to={`/dashboard/currency/exchange/requests/${successData.reference_no}`}
                    className="flex-1 bg-brand-primary text-white py-3 rounded-xl font-semibold hover:bg-brand-primary/95 transition-colors text-center text-sm shadow-sm"
                  >
                    {t("customer.currencyExchange.viewDetails")}
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {!successData && (
          <div className="flex items-start space-x-2 bg-brand-primary/5 border border-brand-primary/10 text-slate-600 rounded-xl p-4 text-xs leading-relaxed mt-6">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-brand-primary" />
            <span>{t("customer.currencyExchange.limitsNotice")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
