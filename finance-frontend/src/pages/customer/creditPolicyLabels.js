/**
 * Translated headlines for CreditPolicyPanel on the CUSTOMER side.
 *
 * The panel itself is language-agnostic and ships English defaults for staff
 * tooling; customer screens run their labels through here so the applicant
 * reads the verdict in their own language. Per the project's translation
 * policy this is headline-level only — the per-rule `detail` sentences come
 * from the server (creditPolicy.service.js) and stay English, as does every
 * admin/staff surface.
 *
 * @param {Function} t react-i18next's translator
 */
export const creditPolicyLabels = (t) => ({
  title: t("customer.creditPolicy.title"),
  outcomePass: t("customer.creditPolicy.outcomePass"),
  outcomeRefer: t("customer.creditPolicy.outcomeRefer"),
  outcomeDecline: t("customer.creditPolicy.outcomeDecline"),
  summaryPass: t("customer.creditPolicy.summaryPass"),
  summaryRefer: t("customer.creditPolicy.summaryRefer"),
  summaryDecline: t("customer.creditPolicy.summaryDecline"),
  metricDti: t("customer.creditPolicy.metricDti"),
  metricResidual: t("customer.creditPolicy.metricResidual"),
  metricLti: t("customer.creditPolicy.metricLti"),
  metricAgeAtMaturity: t("customer.creditPolicy.metricAgeAtMaturity"),
  notEvaluated: t("customer.creditPolicy.notEvaluated"),
  footnote: t("customer.creditPolicy.footnote"),
});
