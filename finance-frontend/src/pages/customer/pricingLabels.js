/**
 * Translated headlines for PricingBadge on the CUSTOMER side. Same
 * convention as creditPolicyLabels.js — headline-level translation only,
 * per the project's i18n policy.
 *
 * @param {Function} t react-i18next's translator
 */
export const pricingLabels = (t) => ({
  rateLabel: t("customer.pricing.rateLabel"),
  tierPreferential: t("customer.pricing.tierPreferential"),
  tierStandard: t("customer.pricing.tierStandard"),
  tierPremium: t("customer.pricing.tierPremium"),
  riskBasedNote: t("customer.pricing.riskBasedNote"),
});
