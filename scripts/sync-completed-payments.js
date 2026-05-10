import {
    closeDatabase,
    initializeDatabase,
    listUnsyncedPaymentSessions,
} from '../db.js';
import { applyDotEnv } from '../env.js';
import { syncSucceededPaymentToGoogleSheets } from '../paymentSync.js';
import { getYooKassaPayment } from '../yookassa.js';

applyDotEnv();

const limit = Number(process.argv[2] ?? '200');

if (!Number.isInteger(limit) || limit < 1) {
    console.error('Укажите положительный integer limit, например: npm run sync:payments -- 200');
    process.exit(1);
}

await initializeDatabase();

let checked = 0;
let synced = 0;
let skipped = 0;
let failed = 0;

try {
    const sessions = await listUnsyncedPaymentSessions(limit);

    for (const session of sessions) {
        checked += 1;

        try {
            const payment = await getYooKassaPayment(session.paymentId);
            const result = await syncSucceededPaymentToGoogleSheets({
                payment,
                logger: console,
            });

            if (result.synced) {
                synced += 1;
                continue;
            }

            skipped += 1;
        } catch (error) {
            failed += 1;
            console.error(`Не удалось обработать платеж ${session.paymentId}: ${error.message}`);
        }
    }
} finally {
    await closeDatabase();
}

console.log(`Проверено: ${checked}`);
console.log(`Синхронизировано: ${synced}`);
console.log(`Пропущено: ${skipped}`);
console.log(`Ошибок: ${failed}`);

if (failed > 0) {
    process.exitCode = 1;
}
