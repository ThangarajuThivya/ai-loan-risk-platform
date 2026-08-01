import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, AlertTriangle, ListChecks, ArrowLeftRight, ChevronRight, Filter } from "lucide-react";

import api from "../../api/axios";
import ExchangeStatusChip from "../../components/currency/ExchangeStatusChip";
import { STATUS_FILTER_OPTIONS, STATUS_META } from "../../constants/fxExchange";

const PAGE_SIZE = 20;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MyExchangeRequests() {
  const { t } = useTranslation();
  const [board, setBoard] = useState(null);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);

  const [statusFilter, setStatusFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/currency/board");
        if (!cancelled) setBoard(res.data);
      } catch {
        if (!cancelled) setBoard(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchPage = async (offset) => {
    const params = { limit: PAGE_SIZE, offset };
    if (statusFilter) params.status = statusFilter;
    if (currencyFilter) params.currency = currencyFilter;
    const res = await api.get("/currency/exchange/requests", { params });
    return res.data?.requests || [];
  };

  // Refetch from the top whenever the server-side filters (status,
  // currency) change — the date filter below is applied client-side since
  // GET /requests has no from/to query params (Phase 10 didn't add one).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await fetchPage(0);
        if (cancelled) return;
        setRequests(rows);
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || t("customer.exchangeRequests.loadErrorDefault"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, currencyFilter]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await fetchPage(requests.length);
      setRequests((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setError(err.response?.data?.message || t("customer.exchangeRequests.loadMoreErrorDefault"));
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (dateFrom && r.created_at.slice(0, 10) < dateFrom) return false;
      if (dateTo && r.created_at.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [requests, dateFrom, dateTo]);

  const currencyOptions = board?.rates?.map((r) => r.currency) || [];

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
              <ListChecks className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{t("customer.exchangeRequests.pageEyebrow")}</p>
              <h1 className="text-sm font-bold text-slate-800">{t("customer.exchangeRequests.pageTitle")}</h1>
            </div>
          </div>
          <Link
            to="/dashboard/currency/exchange"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            {t("customer.exchangeRequests.newExchange")}
          </Link>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 mb-5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
            <Filter className="w-3.5 h-3.5" />
            {t("customer.exchangeRequests.filtersLabel")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">{t("customer.exchangeRequests.statusLabel")}</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary bg-white"
              >
                <option value="">{t("customer.exchangeRequests.allStatuses")}</option>
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">{t("customer.exchangeRequests.currencyLabel")}</label>
              <select
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary bg-white"
              >
                <option value="">{t("customer.exchangeRequests.allCurrencies")}</option>
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">{t("customer.exchangeRequests.fromLabel")}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">{t("customer.exchangeRequests.toLabel")}</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
              />
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && filteredRequests.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
            <p className="text-sm font-semibold text-slate-600 mb-1">{t("customer.exchangeRequests.noRequestsFound")}</p>
            <p className="text-xs text-slate-400 mb-4">
              {requests.length === 0
                ? t("customer.exchangeRequests.noRequestsYet")
                : t("customer.exchangeRequests.noRequestsMatchFilters")}
            </p>
            <Link
              to="/dashboard/currency/exchange"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {t("customer.exchangeRequests.startExchange")}
            </Link>
          </div>
        )}

        {!loading && !error && filteredRequests.length > 0 && (
          <div className="space-y-3">
            {filteredRequests.map((r) => (
              <Link
                key={r.reference_no}
                to={`/dashboard/currency/exchange/requests/${r.reference_no}`}
                className="flex items-center justify-between gap-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 hover:border-brand-primary/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="font-mono text-xs font-bold text-slate-800">{r.reference_no}</span>
                    <ExchangeStatusChip status={r.status} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {r.direction === "buy"
                      ? t("customer.exchangeRequests.directionBuy")
                      : t("customer.exchangeRequests.directionSell")}{" "}
                    {Number(r.foreign_amount).toLocaleString()} {r.currency_code} ·{" "}
                    {formatLkr(r.quoted_lkr_amount)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {t("customer.exchangeRequests.submittedSettlement", {
                      submitted: formatDate(r.created_at),
                      settlement: formatDate(r.settlement_date),
                    })}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </Link>
            ))}

            {hasMore && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60 transition-colors inline-flex items-center gap-2"
                >
                  {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t("customer.exchangeRequests.loadMore")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
