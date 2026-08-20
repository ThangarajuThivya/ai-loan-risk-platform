#!/usr/bin/env bash
# Runs every service-level test suite, in the same order `npm test` always
# has, printing the same "> backend@1.0.0 test" style banner npm itself
# prints — but from inside this script, so it lands in test-results.txt
# too (npm's own banner is printed before the piped/teed command starts,
# so it never reaches the file otherwise).
set -e

FILES=(
  recommendation applicationStatus loanOffer loanFees leasing leaseStatus
  leaseRegistration leaseRegister leasePortfolio leaseRentalQuote
  stripeSessionShape leaseAgreement consent loanSchedule amortization
  repayment repaymentQuote creditPolicy decisionMatrix interestPricing
  adverseAction collateralGuarantor behaviouralFeatures loanDraft
  beneficiaryAccount bankAccount loanDocument loanReports crossRate
  fxQuote liveForecast liveAnomaly fxVar fxCompliance fxReports
  fxInventoryConcurrency leaseNotification leaseReminders nicValidation
  documentExtraction documentValidation ocr documentPipeline
)

echo "> backend@1.0.0 test"
CMD=""
for f in "${FILES[@]}"; do
  CMD="${CMD}${CMD:+ && }node src/services/__tests__/${f}.test.js"
done
echo "> ${CMD}"
echo

for f in "${FILES[@]}"; do
  node "src/services/__tests__/${f}.test.js"
done
