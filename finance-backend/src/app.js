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
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/notifications", require("./routes/notification.routes"));
app.use("/api/currency", require("./routes/currency.routes"));
app.use("/api/currency/exchange", require("./routes/fxExchange.routes"));
app.use("/api/contact-messages", require("./routes/contactMessage.routes"));
app.use("/api/faqs", require("./routes/faq.routes"));


module.exports = app;