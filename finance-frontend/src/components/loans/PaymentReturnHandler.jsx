import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import { formatCurrency } from "../../pages/customer/dashboardFormat";

/**
 * Handles the customer coming back from the payment gateway (040).
 *
 * WHY POLLING RATHER THAN JUST TRUSTING THE REDIRECT: the `?payment=success`
 * in the URL is only the browser's word for it. A customer can type it, and
 * even honestly, arriving here does not mean the payment has been posted —
 * the webhook that posts it routinely lands a moment later. So this asks the
 * server what actually happened and waits for a real answer.
 *
 * The endpoint it polls does more than report: if the intent is still open it
 * asks the gateway directly and settles it (see repayment.controller.js
 * getIntentStatus). That is what makes this work on a local machine where no
 * webhook is configured at all — otherwise a customer whose card was charged
 * would be staring at an unpaid loan.
 *
 * Renders nothing. Mounted once on the dashboard.
 */

const MAX_ATTEMPTS = 8;
const INTERVAL_MS = 1500;

export default function PaymentReturnHandler({ onSettled }) {
  const [params, setParams] = useSearchParams();
  const { showToast } = useToast();
  const { t } = useTranslation();
  // React 18 StrictMode double-invokes effects in development; without this
  // the customer would see every toast twice.
  const handled = useRef(false);

  const payment = params.get("payment");
  const sessionId = params.get("session_id");
  const applicationId = params.get("application");

  useEffect(() => {
    if (!payment || handled.current) return;
    handled.current = true;

    // Clear the query string immediately so a refresh does not replay this,
    // and so the URL stops advertising a session id.
    const clear = () => {
      const next = new URLSearchParams(params);
      ["payment", "session_id", "application"].forEach((k) => next.delete(k));
      setParams(next, { replace: true });
    };

    if (payment === "cancelled") {
      clear();
      showToast({
        type: "info",
        title: t("customer.repayment.cancelledTitle"),
        message: t("customer.repayment.cancelledMessage"),
      });
      return;
    }

    if (payment !== "success" || !sessionId || !applicationId) {
      clear();
      return;
    }

    let stopped = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const res = await api.get(
          `/loans/${applicationId}/payments/intents/${encodeURIComponent(sessionId)}`
        );
        const { status, amount, failure_reason: failureReason } = res.data;

        if (status === "succeeded") {
          clear();
          showToast({
            type: "success",
            title: t("customer.repayment.successTitle"),
            message: t("customer.repayment.successMessage", {
              amount: formatCurrency(amount),
            }),
          });
          onSettled?.();
          return;
        }
        if (status === "failed" || status === "expired" || status === "cancelled") {
          clear();
          showToast({
            type: "error",
            title: t("customer.repayment.failedTitle"),
            message: failureReason || t("customer.repayment.failedMessage"),
          });
          return;
        }
      } catch {
        // Network hiccup — keep trying; the attempt cap ends it.
      }

      if (stopped) return;
      if (attempts >= MAX_ATTEMPTS) {
        clear();
        // Deliberately NOT phrased as a failure. The money may well have been
        // taken and simply not confirmed yet; telling the customer it failed
        // would invite them to pay a second time.
        showToast({
          type: "info",
          title: t("customer.repayment.pendingTitle"),
          message: t("customer.repayment.pendingMessage"),
        });
        onSettled?.();
        return;
      }
      setTimeout(poll, INTERVAL_MS);
    };

    poll();
    return () => {
      stopped = true;
    };
    // Runs once per arrival; `handled` guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment, sessionId, applicationId]);

  return null;
}
