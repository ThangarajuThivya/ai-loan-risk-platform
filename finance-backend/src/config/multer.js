const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/profile");
  },

  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;

    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,

  limits: {
    fileSize: 2 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image allowed"));
    }
  },
});

// --- FX compliance documents -------------------------------------------
//
// A SEPARATE upload instance from the profile-picture one above, not a
// widening of it. Two things must differ:
//
//   1. Destination. `uploads/` is served by src/app.js as unauthenticated
//      express.static, which is fine for an avatar and completely wrong for
//      a passport scan or a tuition invoice. These land in `secure-uploads/`,
//      which nothing serves statically — the only way to read one back is
//      the ownership-checked download route in fxExchange.controller.js.
//
//   2. Accepted types. Supporting evidence is overwhelmingly PDF; the
//      profile filter is images-only.
//
// The filename also drops the customer's original name from the path
// entirely (it is stored in the DB column instead). `Date.now() + "-" +
// file.originalname` is fine for an avatar the user picked, but here the
// original name is attacker-controlled input being concatenated into a
// filesystem path.
const crypto = require("crypto");
const fs = require("fs");

const FX_DOCUMENT_DIR = path.join(__dirname, "..", "..", "secure-uploads", "fx-documents");

const fxDocumentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(FX_DOCUMENT_DIR, { recursive: true }, (err) => cb(err, FX_DOCUMENT_DIR));
  },

  filename: (req, file, cb) => {
    // Random name + extension whitelisted from the mimetype, never from the
    // uploaded filename — so "../../app.js" or "x.pdf.js" cannot influence
    // where this lands or what it is called.
    const ext = file.mimetype === "application/pdf" ? ".pdf" : file.mimetype === "image/png" ? ".png" : ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const FX_DOCUMENT_ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

const fxDocumentUpload = multer({
  storage: fxDocumentStorage,

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (FX_DOCUMENT_ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG or PNG files are accepted as supporting documents."));
    }
  },
});

// --- Loan application documents (E1) ------------------------------------
//
// Same reasoning as the FX block above, applied to loan application
// evidence (NIC, payslips, bank statements): its own directory, never
// mounted under express.static, random filenames, MIME-derived extensions,
// PDF/JPEG/JPG/PNG only, 5MB cap.
const LOAN_DOCUMENT_DIR = path.join(__dirname, "..", "..", "secure-uploads", "loan-documents");

const loanDocumentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(LOAN_DOCUMENT_DIR, { recursive: true }, (err) => cb(err, LOAN_DOCUMENT_DIR));
  },

  filename: (req, file, cb) => {
    const ext = file.mimetype === "application/pdf" ? ".pdf" : file.mimetype === "image/png" ? ".png" : ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const LOAN_DOCUMENT_ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

const loanDocumentUpload = multer({
  storage: loanDocumentStorage,

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (LOAN_DOCUMENT_ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG or PNG files are accepted as supporting documents."));
    }
  },
});

module.exports = upload;
module.exports.fxDocumentUpload = fxDocumentUpload;
module.exports.FX_DOCUMENT_DIR = FX_DOCUMENT_DIR;
module.exports.FX_DOCUMENT_ALLOWED_MIME = FX_DOCUMENT_ALLOWED_MIME;
module.exports.loanDocumentUpload = loanDocumentUpload;
module.exports.LOAN_DOCUMENT_DIR = LOAN_DOCUMENT_DIR;
module.exports.LOAN_DOCUMENT_ALLOWED_MIME = LOAN_DOCUMENT_ALLOWED_MIME;
