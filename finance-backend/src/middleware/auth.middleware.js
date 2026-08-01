const jwt = require("jsonwebtoken");

exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  const token = authHeader && authHeader.split(" ")[1];

  if (!token)
    return res.status(401).json({
      message: "Access denied",
    });

  jwt.verify(
    token,

    process.env.ACCESS_TOKEN_SECRET,

    (err, user) => {
      if (err)
        return res.status(403).json({
          message: "Token expired",
        });

      req.user = user;

      next();
    },
  );
};
