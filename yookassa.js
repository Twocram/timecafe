import { randomUUID } from 'node:crypto';

function getYooKassaConfig() {
    const {
        PORT = '3000',
        YOOKASSA_SHOP_ID,
        YOOKASSA_SECRET_KEY,
        YOOKASSA_RETURN_URL = `http://localhost:${PORT}/?payment=return`,
        YOOKASSA_RECEIPT_EMAIL,
        YOOKASSA_VAT_CODE = '1',
    } = process.env;

    return {
        YOOKASSA_SHOP_ID,
        YOOKASSA_SECRET_KEY,
        YOOKASSA_RETURN_URL,
        YOOKASSA_RECEIPT_EMAIL,
        YOOKASSA_VAT_CODE,
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

function buildReceipt({ amount, description, customerEmail }) {
    const { YOOKASSA_RECEIPT_EMAIL, YOOKASSA_VAT_CODE } = getYooKassaConfig();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail ?? '')
        ? customerEmail
        : YOOKASSA_RECEIPT_EMAIL;

    if (!email) {
        throw new Error('Для чека нужен email гостя или YOOKASSA_RECEIPT_EMAIL в .env');
    }

    return {
        customer: { email },
        items: [{
            description: String(description).slice(0, 128),
            quantity: '1.00',
            amount: {
                value: Number(amount).toFixed(2),
                currency: 'RUB',
            },
            vat_code: Number(YOOKASSA_VAT_CODE),
            payment_mode: 'full_payment',
            payment_subject: 'service',
        }],
    };
}

async function createYooKassaPayment({ amount, description, metadata, returnToken, customerEmail }) {
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
            receipt: buildReceipt({ amount, description, customerEmail }),
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
