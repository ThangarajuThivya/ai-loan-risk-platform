const bcrypt = require("bcrypt");
const db = require("../config/db");

const seedAdmin = async () => {
    try {

        // Check if admin already exists
        const [rows] = await db.promise().query(
            "SELECT * FROM users WHERE role = 'admin' LIMIT 1"
        );

        if (rows.length > 0) {
            console.log("✅ Admin already exists");
            return;
        }

        const hashedPassword = await bcrypt.hash("Admin@123", 10);

        await db.promise().query(
            `INSERT INTO users
            (first_name, last_name, email, password, role, status, email_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                "System",
                "Administrator",
                "admin@aura.com",
                hashedPassword,
                "admin",
                "active",
                1
            ]
        );

        console.log("🎉 Default Admin Created");

    } catch (err) {
        console.error(err);
    }
};

module.exports = seedAdmin;