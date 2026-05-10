import {
    findPaymentSessionByPaymentId,
    markPaymentSessionSynced,
} from './db.js';
import {
    appendSucceededPaymentToGoogleSheets,
    isGoogleSheetsSyncEnabled,
} from './googleSheets.js';

function isSucceededPayment(payment) {
    return payment?.status === 'succeeded' || Boolean(payment?.paid);
}

async function syncSucceededPaymentToGoogleSheets({ payment, logger }) {
    if (!isGoogleSheetsSyncEnabled()) {
        return {
            synced: false,
            reason: 'not_configured',
        };
    }

    if (!isSucceededPayment(payment)) {
        return {
            synced: false,
            reason: 'not_succeeded',
        };
    }

    const session = await findPaymentSessionByPaymentId(payment.id);
    if (!session) {
        return {
            synced: false,
            reason: 'session_not_found',
        };
    }

    if (session.googleSheetsSyncedAt) {
        return {
            synced: false,
            reason: 'already_synced',
        };
    }

    await appendSucceededPaymentToGoogleSheets({ payment, session });
    await markPaymentSessionSynced(payment.id);

    logger?.info?.({
        paymentId: payment.id,
    }, 'Succeeded payment was synced to Google Sheets');

    return {
        synced: true,
        reason: 'ok',
    };
}

export {
    isSucceededPayment,
    syncSucceededPaymentToGoogleSheets,
};
