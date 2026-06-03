import { Pool } from 'pg';

function normalizeBoolean(value) {
    return ['1', 'true', 'yes', 'on', 'require'].includes(String(value).toLowerCase());
}

function getSslConfig(databaseUrl) {
    const { DATABASE_SSL } = process.env;

    if (DATABASE_SSL !== undefined) {
        if (!normalizeBoolean(DATABASE_SSL)) {
            return undefined;
        }

        return {
            rejectUnauthorized: false,
        };
    }

    if (!databaseUrl) {
        return undefined;
    }

    const hostname = getDatabaseHostname(databaseUrl);
    if (!hostname?.endsWith('.supabase.co')) {
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

function isDirectSupabaseHostname(hostname) {
    return hostname?.startsWith('db.') && hostname.endsWith('.supabase.co');
}

function createSupabaseIpv4Error(hostname) {
    return new Error(
        `Supabase direct database host "${hostname}" is IPv6-only. This machine/network cannot resolve it through Node.js. In Supabase, open Database -> Connection string -> Session Pooler and use that pooler URL in DATABASE_URL instead of the direct db.*.supabase.co URL.`,
    );
}

function normalizeConnectionError(error) {
    if (error?.code !== 'ENOTFOUND') {
        return error;
    }

    const databaseUrl = process.env.DATABASE_URL;
    const hostname = databaseUrl ? getDatabaseHostname(databaseUrl) : null;
    if (!isDirectSupabaseHostname(hostname)) {
        return error;
    }

    const normalizedError = createSupabaseIpv4Error(hostname);
    normalizedError.cause = error;
    return normalizedError;
}

async function queryDatabase(text, params) {
    try {
        return await getPool().query(text, params);
    } catch (error) {
        throw normalizeConnectionError(error);
    }
}

function isManagedHostingEnvironment() {
    return Boolean(
        process.env.RENDER
        || process.env.RENDER_SERVICE_ID
        || process.env.RAILWAY_ENVIRONMENT
        || process.env.RAILWAY_PROJECT_ID,
    );
}

function assertHostedDatabaseConfig({ DATABASE_URL, PGHOST }) {
    if (!isManagedHostingEnvironment()) {
        return;
    }

    const hostname = DATABASE_URL ? getDatabaseHostname(DATABASE_URL) : null;

    if (hostname === 'db' || PGHOST === 'db') {
        throw new Error(
            'Хост БД "db" работает только внутри docker compose. Для Render/Railway укажите внешний PostgreSQL URL, например Supabase, в DATABASE_URL или задайте PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.',
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
    const ssl = getSslConfig(DATABASE_URL);

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
    await queryDatabase(`
        CREATE TABLE IF NOT EXISTS payment_sessions (
            return_token TEXT PRIMARY KEY,
            payment_id TEXT NOT NULL UNIQUE,
            customer_name TEXT,
            amount NUMERIC(10, 2) NOT NULL,
            description TEXT NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            google_sheets_synced_at TIMESTAMPTZ
        )
    `);

    await queryDatabase(`
        ALTER TABLE payment_sessions
        ADD COLUMN IF NOT EXISTS google_sheets_synced_at TIMESTAMPTZ
    `);

    await queryDatabase(`
        ALTER TABLE payment_sessions
        ADD COLUMN IF NOT EXISTS customer_name TEXT
    `);

    await queryDatabase(`
        UPDATE payment_sessions
        SET customer_name = metadata->>'customer_name'
        WHERE customer_name IS NULL
          AND metadata ? 'customer_name'
    `);
}

async function savePaymentSession({ returnToken, paymentId, customerName, amount, description, metadata = {} }) {
    await getPool().query(`
        INSERT INTO payment_sessions (return_token, payment_id, customer_name, amount, description, metadata)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (return_token) DO UPDATE SET
            payment_id = EXCLUDED.payment_id,
            customer_name = EXCLUDED.customer_name,
            amount = EXCLUDED.amount,
            description = EXCLUDED.description,
            metadata = EXCLUDED.metadata
    `, [
        returnToken,
        paymentId,
        customerName,
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

function mapPaymentSessionRow(row) {
    if (!row) {
        return null;
    }

    return {
        returnToken: row.return_token,
        paymentId: row.payment_id,
        customerName: row.customer_name,
        amount: Number(row.amount),
        description: row.description,
        metadata: row.metadata ?? {},
        createdAt: row.created_at,
        googleSheetsSyncedAt: row.google_sheets_synced_at,
    };
}

async function findPaymentSessionByPaymentId(paymentId) {
    const result = await getPool().query(`
        SELECT return_token, payment_id, customer_name, amount, description, metadata, created_at, google_sheets_synced_at
        FROM payment_sessions
        WHERE payment_id = $1
        LIMIT 1
    `, [paymentId]);

    return mapPaymentSessionRow(result.rows[0]);
}

async function findPaymentSessionByReturnToken(returnToken) {
    const result = await getPool().query(`
        SELECT return_token, payment_id, customer_name, amount, description, metadata, created_at, google_sheets_synced_at
        FROM payment_sessions
        WHERE return_token = $1
        LIMIT 1
    `, [returnToken]);

    return mapPaymentSessionRow(result.rows[0]);
}

async function listUnsyncedPaymentSessions(limit = 100) {
    const result = await getPool().query(`
        SELECT return_token, payment_id, customer_name, amount, description, metadata, created_at, google_sheets_synced_at
        FROM payment_sessions
        WHERE google_sheets_synced_at IS NULL
        ORDER BY created_at ASC
        LIMIT $1
    `, [limit]);

    return result.rows.map(mapPaymentSessionRow);
}

async function markPaymentSessionSynced(paymentId) {
    await getPool().query(`
        UPDATE payment_sessions
        SET google_sheets_synced_at = NOW()
        WHERE payment_id = $1
    `, [paymentId]);
}

async function checkDatabaseHealth() {
    await queryDatabase('SELECT 1');
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
    findPaymentSessionByReturnToken,
    findPaymentSessionByPaymentId,
    initializeDatabase,
    listUnsyncedPaymentSessions,
    markPaymentSessionSynced,
    savePaymentSession,
};
