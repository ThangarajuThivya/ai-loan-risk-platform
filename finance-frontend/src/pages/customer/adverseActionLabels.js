/**
 * Translated headlines for AdverseActionPanel on the CUSTOMER side. Same
 * convention as creditPolicyLabels.js/pricingLabels.js — headline-level
 * translation only; the reason label/description text itself comes from
 * the server and stays English for every viewer.
 *
 * @param {Function} t react-i18next's translator
 */
export const adverseActionLabels = (t) => ({
  title: t("customer.adverseAction.title"),
  automatedNote: t("customer.adverseAction.automatedNote"),
  footnote: t("customer.adverseAction.footnote"),
});
