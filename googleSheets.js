function isGoogleSheetsSyncEnabled() {
    return Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL);
}

function buildGoogleSheetsPayload({ payment, session }) {
    return {
        event: 'payment.succeeded',
        paymentId: session.paymentId,
        returnToken: session.returnToken,
        customerName: session.customerName ?? '',
        amount: Number(session.amount).toFixed(2),
        currency: payment.amount?.currency ?? 'RUB',
        description: session.description,
        status: payment.status,
        paid: Boolean(payment.paid),
        createdAt: session.createdAt?.toISOString?.() ?? session.createdAt ?? null,
        yookassaCreatedAt: payment.created_at ?? null,
        paidAt: payment.captured_at ?? null,
        metadata: session.metadata ?? {},
    };
}

async function appendSucceededPaymentToGoogleSheets({ payment, session }) {
    const { GOOGLE_SHEETS_WEBHOOK_URL } = process.env;

    if (!GOOGLE_SHEETS_WEBHOOK_URL) {
        return {
            skipped: true,
            reason: 'not_configured',
        };
    }

    const payload = buildGoogleSheetsPayload({ payment, session });
    const response = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ошибка Google Sheets webhook: ${response.status} ${errorText}`);
    }

    return {
        skipped: false,
    };
}

export {
    appendSucceededPaymentToGoogleSheets,
    buildGoogleSheetsPayload,
    isGoogleSheetsSyncEnabled,
};
