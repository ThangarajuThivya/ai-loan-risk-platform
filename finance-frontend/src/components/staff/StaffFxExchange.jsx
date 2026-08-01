import FxRequestQueue from "../currency/FxRequestQueue";

/**
 * Staff-side FX exchange review queue (CURRENCY_FEATURE.md §12, Phase 12).
 * Thin wrapper around the shared FxRequestQueue — defaults to
 * pending_review (the actual working queue, oldest-first per
 * fxExchangeModel.findQueue's ORDER BY r.created_at ASC), with a staff-
 * appropriate title. `customers` is passed down from StaffDashboard, which
 * already fetches GET /admin/getAllCustomer for the Customers tab — reused
 * here for the detail drawer's customer-profile summary instead of a
 * second fetch.
 */
export default function StaffFxExchange({ customers }) {
  return (
    <FxRequestQueue
      customers={customers}
      defaultStatus="pending_review"
      title="FX Exchange Review Queue"
      subtitle="Approve, reject, or counter-quote customer currency exchange requests."
    />
  );
}
