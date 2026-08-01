// Applies every migration in db/migrations/ against the DB configured in
// .env, in filename order (001_, 002_, 003_, ...).
//
// Usage:
//   npm run migrate
//
// Each migration file is idempotent (CREATE TABLE IF NOT EXISTS / existence
// checks before INSERT), so re-running this after new migrations are added
// is safe.

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function run() {
    const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

    for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"]) {
        if (!process.env[key]) {
            throw new Error(`${key} is not set in .env`);
        }
    }

    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    if (files.length === 0) {
        console.log(`No migrations found in ${MIGRATIONS_DIR}`);
        return;
    }

    const connection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        multipleStatements: true,
    });

    try {
        for (const file of files) {
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
            console.log(`Applying ${file}...`);
            await connection.query(sql);
        }
        console.log(`All migrations applied to '${DB_NAME}'.`);
    } finally {
        await connection.end();
    }
}

run().catch((err) => {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
});
