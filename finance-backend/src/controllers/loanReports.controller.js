"use strict";

/**
 * Loan portfolio dashboard (F1) — one endpoint aggregating approval rates,
 * disbursement volumes, portfolio-at-risk, and product/risk distribution
 * for staff/admin. All arithmetic lives in loanReports.service.js (pure,
 * unit-tested); this controller only fetches the raw rows and wires them
 * through.
 */

const { validationResult } = require("express-validator");
const loanModel = require("../models/loanModel");
const {
  summarizeApprovalRates,
  summarizeProductDistribution,
  summarizeRiskDistribution,
  summarizeDisbursement,
  summarizePortfolioAtRisk,
} = require("../services/loanReports.service");

// GET /api/admin/portfolio-dashboard (staff/admin).
exports.getPortfolioDashboard = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const months = req.query.months ? Number(req.query.months) : 12;

  try {
    const [applications, accounts, activeScheduleRows] = await Promise.all([
      loanModel.getPortfolioApplications(),
      loanModel.getPortfolioAccounts(),
      loanModel.getActivePortfolioScheduleRows(),
    ]);

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      approval: summarizeApprovalRates(applications),
      product_distribution: summarizeProductDistribution(applications),
      risk_distribution: summarizeRiskDistribution(applications),
      disbursement: summarizeDisbursement(accounts, { months }),
      portfolio_at_risk: summarizePortfolioAtRisk(activeScheduleRows),
    });
  } catch (err) {
    console.error("GET PORTFOLIO DASHBOARD ERROR:", err);
    return res.status(500).json({ message: "Failed to compute the portfolio dashboard." });
  }
};
