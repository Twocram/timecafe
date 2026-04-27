import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function applyDotEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!existsSync(envPath)) {
        return;
    }

    const fileContents = readFileSync(envPath, 'utf8');

    for (const rawLine of fileContents.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

applyDotEnv();

const {
    PORT = '3000',
    YOOKASSA_SHOP_ID,
    YOOKASSA_SECRET_KEY,
    YOOKASSA_RETURN_URL = `http://localhost:${PORT}/?payment=return`,
} = process.env;

const app = Fastify({ logger: true });
const paymentReturnMap = new Map();

await app.register(fastifyStatic, {
    root: __dirname,
});

function assertYooKassaConfig() {
    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
        throw new Error('YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY должны быть указаны в .env');
    }
}

function getYooKassaAuthHeader() {
    const credentials = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
    return `Basic ${credentials}`;
}

function buildReturnUrl(returnToken) {
    const returnUrl = new URL(YOOKASSA_RETURN_URL);
    returnUrl.searchParams.set('payment', 'return');
    returnUrl.searchParams.set('payment_key', returnToken);
    return returnUrl.toString();
}

async function createYooKassaPayment({ amount, description, metadata, returnToken }) {
    assertYooKassaConfig();

    const response = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
            Authorization: getYooKassaAuthHeader(),
            'Content-Type': 'application/json',
            'Idempotence-Key': randomUUID(),
        },
        body: JSON.stringify({
            amount: {
                value: Number(amount).toFixed(2),
                currency: 'RUB',
            },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: buildReturnUrl(returnToken),
            },
            description,
            metadata,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ошибка ЮKassa: ${response.status} ${errorText}`);
    }

    return response.json();
}

async function getYooKassaPayment(paymentId) {
    assertYooKassaConfig();

    const response = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
        method: 'GET',
        headers: {
            Authorization: getYooKassaAuthHeader(),
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ошибка ЮKassa: ${response.status} ${errorText}`);
    }

    return response.json();
}

app.post('/api/payments', {
    schema: {
        body: {
            type: 'object',
            required: ['amount', 'description'],
            properties: {
                amount: { type: 'number', minimum: 1 },
                description: { type: 'string', minLength: 1 },
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
        const payment = await createYooKassaPayment(request.body);
        paymentReturnMap.set(request.body.returnToken, payment.id);

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
    const paymentId = paymentReturnMap.get(request.params.returnToken);

    if (!paymentId) {
        reply.code(404);
        return {
            error: 'Платёж по ключу возврата не найден',
        };
    }

    return { paymentId };
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
