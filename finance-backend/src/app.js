const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const path = require("path");


const app = express();


app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);


app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
    crossOriginOpenerPolicy: false,
  })
);


// Payment gateway webhooks (040) — MOUNTED BEFORE express.json() ON PURPOSE.
//
// Stripe signs the raw request bytes. express.json() would consume the stream
// and hand the route a parsed object, and re-serialising that never reproduces
// the original bytes (key order, whitespace), so every signature check would
// fail. express.raw here keeps req.body as the untouched Buffer that
// stripe.service.constructWebhookEvent needs.
//
// Scoped to this one path, so every other route still parses JSON as before.
app.use(
  "/api/payments",
  express.raw({ type: "application/json" }),
  require("./routes/paymentWebhook.routes")
);

app.use(express.json());

app.use(morgan("dev"));

app.use(
  express.urlencoded({
    extended: true,
  })
);


app.use(cookieParser());


// Upload images
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader(
      "Cross-Origin-Resource-Policy",
      "cross-origin"
    );
    next();
  },
  express.static(
    path.join(__dirname, "../uploads")
  )
);




app.get("/", (req,res)=>{
    res.json({
        message:"Aura AI Loan Backend Running..."
    });
});


app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/user", require("./routes/user.routes"));
app.use("/api/loans", require("./routes/loan.routes"));
// Leasing is a distinct financing type, so it gets its own top-level
// namespace rather than living under /api/loans — see ARCHITECTURE.md §9.19.
app.use("/api/leases", require("./routes/lease.routes"));
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/notifications", require("./routes/notification.routes"));
app.use("/api/currency", require("./routes/currency.routes"));
app.use("/api/currency/exchange", require("./routes/fxExchange.routes"));
app.use("/api/contact-messages", require("./routes/contactMessage.routes"));
app.use("/api/faqs", require("./routes/faq.routes"));
app.use("/api/consents", require("./routes/consent.routes"));


module.exports = app;