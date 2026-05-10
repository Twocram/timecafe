import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
    checkDatabaseHealth,
    closeDatabase,
    findPaymentSessionByReturnToken,
    initializeDatabase,
    savePaymentSession,
} from './db.js';
import { applyDotEnv } from './env.js';
import { syncSucceededPaymentToGoogleSheets } from './paymentSync.js';
import { createYooKassaPayment, getYooKassaPayment } from './yookassa.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

applyDotEnv();

const {
    PORT = '3000',
    DATABASE_URL,
    PGHOST,
    PGPORT = '5432',
    PGUSER,
    PGPASSWORD,
    PGDATABASE,
} = process.env;

const app = Fastify({ logger: true });

await app.register(fastifyStatic, {
    root: __dirname,
});

function assertDatabaseConfig() {
    if (DATABASE_URL) {
        return;
    }

    if (!PGHOST || !PGUSER || !PGPASSWORD || !PGDATABASE || !PGPORT) {
        throw new Error('Укажите DATABASE_URL или набор PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE');
    }
}

function normalizeCustomerName(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeBoolean(value) {
    return ['1', 'true', 'yes', 'on', 'require'].includes(String(value).toLowerCase());
}

function isPaymentWebhookEvent(payload) {
    return payload?.type === 'notification'
        && typeof payload?.event === 'string'
        && payload?.object
        && typeof payload.object === 'object';
}

assertDatabaseConfig();
await initializeDatabase();

app.addHook('onClose', async () => {
    await closeDatabase();
});

app.post('/api/payments', {
    schema: {
        body: {
            type: 'object',
            required: ['amount', 'description', 'customerName'],
            properties: {
                amount: { type: 'number', minimum: 1 },
                description: { type: 'string', minLength: 1 },
                customerName: { type: 'string', minLength: 1, maxLength: 80 },
                returnToken: { type: 'string', minLength: 1 },
                metadata: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                },
            },
        },
    },
}, async (request, reply) => {
    try {
        const customerName = normalizeCustomerName(request.body.customerName);
        if (!customerName) {
            reply.code(400);
            return {
                error: 'Укажите имя гостя',
            };
        }

        const payment = await createYooKassaPayment(request.body);
        await savePaymentSession({
            returnToken: request.body.returnToken,
            paymentId: payment.id,
            customerName,
            amount: request.body.amount,
            description: request.body.description,
            metadata: {
                ...(request.body.metadata ?? {}),
                customer_name: customerName,
            },
        });

        return {
            id: payment.id,
            status: payment.status,
            confirmationUrl: payment.confirmation?.confirmation_url ?? null,
        };
    } catch (error) {
        request.log.error(error);
        reply.code(500);
        return {
            error: error.message || 'Не удалось создать платеж',
        };
    }
});

app.get('/api/payments/lookup/:returnToken', {
    schema: {
        params: {
            type: 'object',
            required: ['returnToken'],
            properties: {
                returnToken: { type: 'string', minLength: 1 },
            },
        },
    },
}, async (request, reply) => {
    try {
        const session = await findPaymentSessionByReturnToken(request.params.returnToken);

        if (!session?.paymentId) {
            reply.code(404);
            return {
                error: 'Платёж по ключу возврата не найден',
            };
        }

        return {
            paymentId: session.paymentId,
            customerName: session.customerName,
            amount: session.amount,
            description: session.description,
            metadata: session.metadata,
        };
    } catch (error) {
        request.log.error(error);
        reply.code(500);
        return {
            error: error.message || 'Не удалось найти платёж по ключу возврата',
        };
    }
});

app.get('/api/payments/:paymentId', {
    schema: {
        params: {
            type: 'object',
            required: ['paymentId'],
            properties: {
                paymentId: { type: 'string', minLength: 1 },
            },
        },
    },
}, async (request, reply) => {
    try {
        const payment = await getYooKassaPayment(request.params.paymentId);
        try {
            await syncSucceededPaymentToGoogleSheets({
                payment,
                logger: request.log,
            });
        } catch (error) {
            request.log.error({
                err: error,
                paymentId: request.params.paymentId,
            }, 'Google Sheets sync failed');
        }

        return {
            id: payment.id,
            status: payment.status,
            paid: payment.paid,
        };
    } catch (error) {
        request.log.error(error);
        reply.code(500);
        return {
            error: error.message || 'Не удалось получить статус платежа',
        };
    }
});

app.post('/api/yookassa/webhook', {
    schema: {
        body: {
            type: 'object',
            required: ['type', 'event', 'object'],
            properties: {
                type: { type: 'string' },
                event: { type: 'string' },
                object: { type: 'object' },
            },
            additionalProperties: true,
        },
    },
}, async (request, reply) => {
    if (!isPaymentWebhookEvent(request.body)) {
        reply.code(400);
        return {
            ok: false,
            error: 'Некорректное тело webhook',
        };
    }

    try {
        if (request.body.event === 'payment.succeeded') {
            await syncSucceededPaymentToGoogleSheets({
                payment: request.body.object,
                logger: request.log,
            });
        }

        return {
            ok: true,
        };
    } catch (error) {
        request.log.error({
            err: error,
            event: request.body.event,
            paymentId: request.body.object?.id,
        }, 'YooKassa webhook handling failed');

        reply.code(500);
        return {
            ok: false,
            error: error.message || 'Не удалось обработать webhook YooKassa',
        };
    }
});

app.get('/health', async (_request, reply) => {
    try {
        assertDatabaseConfig();
        await checkDatabaseHealth();

        return {
            ok: true,
            database: 'up',
        };
    } catch (error) {
        reply.code(503);
        return {
            ok: false,
            database: 'down',
            error: error.message,
        };
    }
});

app.get('/api/config', async () => ({
    isTesting: normalizeBoolean(process.env.IS_TESTING),
}));

app.get('/', async (_request, reply) => reply.sendFile('index.html'));

try {
    await app.listen({
        port: Number(PORT),
        host: '0.0.0.0',
    });
} catch (error) {
    app.log.error(error);
    process.exit(1);
}
