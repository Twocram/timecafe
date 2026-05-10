import { randomUUID } from 'node:crypto';

function getYooKassaConfig() {
    const {
        PORT = '3000',
        YOOKASSA_SHOP_ID,
        YOOKASSA_SECRET_KEY,
        YOOKASSA_RETURN_URL = `http://localhost:${PORT}/?payment=return`,
    } = process.env;

    return {
        YOOKASSA_SHOP_ID,
        YOOKASSA_SECRET_KEY,
        YOOKASSA_RETURN_URL,
    };
}

function assertYooKassaConfig() {
    const {
        YOOKASSA_SHOP_ID,
        YOOKASSA_SECRET_KEY,
    } = getYooKassaConfig();

    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
        throw new Error('YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY должны быть указаны в .env');
    }
}

function getYooKassaAuthHeader() {
    const {
        YOOKASSA_SHOP_ID,
        YOOKASSA_SECRET_KEY,
    } = getYooKassaConfig();
    const credentials = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
    return `Basic ${credentials}`;
}

function buildReturnUrl(returnToken) {
    const {
        YOOKASSA_RETURN_URL,
    } = getYooKassaConfig();
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

export {
    createYooKassaPayment,
    getYooKassaPayment,
};
