const jwt = require("jsonwebtoken");

// Access Token
exports.generateAccessToken = (user) => {
  return jwt.sign(
    {
      user_id: user.user_id,
      role: user.role,
      email: user.email,
    },
    process.env.ACCESS_TOKEN_SECRET,

    {
      expiresIn: "15m",
    },
  );
};

// Refresh Token

exports.generateRefreshToken = (user) => {
  return jwt.sign(
    {
      user_id: user.user_id,
      role: user.role,
      email: user.email,
    },

    process.env.REFRESH_TOKEN_SECRET,

    {
      expiresIn: "7d",
    },
  );
};
