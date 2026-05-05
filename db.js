import { Pool } from 'pg';

function normalizeBoolean(value) {
    return ['1', 'true', 'yes', 'on', 'require'].includes(String(value).toLowerCase());
}

function getSslConfig() {
    const { DATABASE_SSL = 'false' } = process.env;

    if (!normalizeBoolean(DATABASE_SSL)) {
        return undefined;
    }

    return {
        rejectUnauthorized: false,
    };
}

function getDatabaseHostname(databaseUrl) {
    try {
        return new URL(databaseUrl).hostname;
    } catch {
        return null;
    }
}

function assertHostedDatabaseConfig({ DATABASE_URL, PGHOST }) {
    const hostname = DATABASE_URL ? getDatabaseHostname(DATABASE_URL) : null;

    if (hostname === 'db' || PGHOST === 'db') {
        throw new Error(
            'Хост БД "db" работает только внутри docker compose. Для Render укажите реальный managed PostgreSQL URL в DATABASE_URL или задайте PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.',
        );
    }
}

function createPool() {
    const {
        DATABASE_URL,
        PGHOST,
        PGPORT,
        PGUSER,
        PGPASSWORD,
        PGDATABASE,
    } = process.env;
    const ssl = getSslConfig();

    assertHostedDatabaseConfig({ DATABASE_URL, PGHOST });

    if (DATABASE_URL) {
        return new Pool({
            connectionString: DATABASE_URL,
            ssl,
        });
    }

    return new Pool({
        host: PGHOST,
        port: PGPORT ? Number(PGPORT) : undefined,
        user: PGUSER,
        password: PGPASSWORD,
        database: PGDATABASE,
        ssl,
    });
}

let pool;

function getPool() {
    if (!pool) {
        pool = createPool();
    }

    return pool;
}

async function initializeDatabase() {
    await getPool().query(`
        CREATE TABLE IF NOT EXISTS payment_sessions (
            return_token TEXT PRIMARY KEY,
            payment_id TEXT NOT NULL UNIQUE,
            amount NUMERIC(10, 2) NOT NULL,
            description TEXT NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function savePaymentSession({ returnToken, paymentId, amount, description, metadata = {} }) {
    await getPool().query(`
        INSERT INTO payment_sessions (return_token, payment_id, amount, description, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (return_token) DO UPDATE SET
            payment_id = EXCLUDED.payment_id,
            amount = EXCLUDED.amount,
            description = EXCLUDED.description,
            metadata = EXCLUDED.metadata
    `, [
        returnToken,
        paymentId,
        Number(amount).toFixed(2),
        description,
        JSON.stringify(metadata),
    ]);
}

async function findPaymentIdByReturnToken(returnToken) {
    const result = await getPool().query(`
        SELECT payment_id
        FROM payment_sessions
        WHERE return_token = $1
        LIMIT 1
    `, [returnToken]);

    return result.rows[0]?.payment_id ?? null;
}

async function checkDatabaseHealth() {
    await getPool().query('SELECT 1');
}

async function closeDatabase() {
    if (!pool) {
        return;
    }

    await pool.end();
    pool = null;
}

export {
    checkDatabaseHealth,
    closeDatabase,
    findPaymentIdByReturnToken,
    initializeDatabase,
    savePaymentSession,
};
