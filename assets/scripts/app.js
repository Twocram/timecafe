import { PENDING_PAYMENT_KEY, STORAGE_KEY } from './config.js';
import { calculateVisitCost, isWeekend, isWithinWorkingHours } from './pricing.js';

const elements = {
    startBtn: document.getElementById('startBtn'),
    endBtn: document.getElementById('endBtn'),
    payBtn: document.getElementById('payBtn'),
    statusLed: document.getElementById('statusLed'),
    statusText: document.getElementById('statusText'),
    totalAmount: document.getElementById('totalAmount'),
    infoMessage: document.getElementById('infoMessage'),
    currentTimeDisplay: document.getElementById('currentTimeDisplay'),
    visitDetails: document.getElementById('visitDetails'),
    timeRange: document.getElementById('timeRange'),
    durationMinutes: document.getElementById('durationMinutes'),
    paymentState: document.getElementById('paymentState'),
    paymentStateIcon: document.getElementById('paymentStateIcon'),
    paymentStateTitle: document.getElementById('paymentStateTitle'),
    paymentStateText: document.getElementById('paymentStateText'),
};

const state = {
    activeVisitStart: null,
    pendingPayment: null,
};

function wait(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function showToast(message, type = 'success') {
    const toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);
    document.body.appendChild(toastContainer);

    requestAnimationFrame(() => {
        toast.classList.add('is-visible');
    });

    window.setTimeout(() => {
        toast.classList.remove('is-visible');
        window.setTimeout(() => {
            toastContainer.remove();
        }, 250);
    }, 3500);
}

function showPaymentState({ title, text, tone = 'loading' }) {
    elements.paymentState.classList.remove('is-success', 'is-error');

    if (tone === 'success') {
        elements.paymentState.classList.add('is-success');
        elements.paymentStateIcon.innerHTML = '<i class="fas fa-check"></i>';
    } else if (tone === 'error') {
        elements.paymentState.classList.add('is-error');
        elements.paymentStateIcon.innerHTML = '<i class="fas fa-exclamation"></i>';
    } else {
        elements.paymentStateIcon.innerHTML = '<div class="payment-spinner"></div>';
    }

    elements.paymentStateTitle.textContent = title;
    elements.paymentStateText.textContent = text;
    elements.paymentState.style.display = 'flex';
}

function hidePaymentState() {
    elements.paymentState.style.display = 'none';
    elements.paymentState.classList.remove('is-success', 'is-error');
}

function setInfoMessage(message) {
    elements.infoMessage.innerHTML = message;
}

function hideVisitDetails() {
    elements.visitDetails.style.display = 'none';
}

function showVisitDetails(result) {
    const startTimeStr = result.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTimeStr = result.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    elements.timeRange.innerHTML = `${startTimeStr} – ${endTimeStr}`;
    elements.durationMinutes.innerHTML = result.totalMinutes;
    elements.visitDetails.style.display = 'block';
}

function resetPaymentState() {
    state.pendingPayment = null;
    localStorage.removeItem(PENDING_PAYMENT_KEY);
    elements.payBtn.style.display = 'none';
    hidePaymentState();
}

function renderAmount(cost) {
    elements.totalAmount.innerHTML = `${cost} <span>₽</span>`;
}

function savePendingPayment() {
    if (!state.pendingPayment) {
        localStorage.removeItem(PENDING_PAYMENT_KEY);
        return;
    }

    localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
        id: state.pendingPayment.id ?? null,
        cost: state.pendingPayment.cost,
        totalMinutes: state.pendingPayment.totalMinutes,
        startTime: state.pendingPayment.startTime.toISOString(),
        endTime: state.pendingPayment.endTime.toISOString(),
    }));
}

async function fetchApi(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
        },
        ...options,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(payload?.error || 'Ошибка запроса');
    }

    return payload;
}

async function getPaymentStatusWithRetry(paymentId, attempts = 6, delayMs = 1500) {
    let lastPayment = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        lastPayment = await fetchApi(`/api/payments/${paymentId}`);

        if (lastPayment.status === 'succeeded' || lastPayment.paid || lastPayment.status === 'canceled') {
            return lastPayment;
        }

        if (attempt < attempts - 1) {
            await wait(delayMs);
        }
    }

    return lastPayment;
}

function clearActiveVisit() {
    state.activeVisitStart = null;
    localStorage.removeItem(STORAGE_KEY);
}

function updateUIByState() {
    const isActive = state.activeVisitStart !== null;

    if (isActive) {
        elements.statusLed.classList.add('active');
        const startTimeStr = state.activeVisitStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        elements.statusText.innerHTML = `🟢 Визит активен (начало в ${startTimeStr})`;
        elements.startBtn.disabled = true;
        elements.endBtn.disabled = false;
        elements.payBtn.disabled = true;
        return;
    }

    elements.statusLed.classList.remove('active');
    elements.statusText.innerHTML = '⚪ Нет активного визита';
    elements.startBtn.disabled = false;
    elements.endBtn.disabled = true;
    elements.payBtn.disabled = !state.pendingPayment;
}

function startVisit() {
    if (state.activeVisitStart) {
        setInfoMessage('Визит уже активен. Завершите текущий, чтобы начать новый.');
        return;
    }

    const now = new Date();
    if (!isWithinWorkingHours(now)) {
        setInfoMessage('⏰ Кафе сейчас закрыто. Расписание: выходные 10:00–22:00, будни 12:00–22:00.');
        return;
    }

    state.activeVisitStart = now;
    localStorage.setItem(STORAGE_KEY, state.activeVisitStart.toISOString());
    resetPaymentState();
    updateUIByState();
    setInfoMessage('🎉 Визит начат! Не забудьте нажать «Завершить визит» при выходе.');
    renderAmount(0);
    hideVisitDetails();
    hidePaymentState();
}

function finishVisit() {
    if (!state.activeVisitStart) {
        setInfoMessage('Нет активного визита.');
        hideVisitDetails();
        return;
    }

    const result = calculateVisitCost(state.activeVisitStart, new Date());
    if (result.error) {
        setInfoMessage(`❌ Ошибка: ${result.error}`);
        renderAmount(0);
        hideVisitDetails();
        return;
    }

    renderAmount(result.cost);
    state.pendingPayment = result;
    savePendingPayment();
    showVisitDetails(result);

    const weekendFlag = isWeekend(state.activeVisitStart);
    const stopText = weekendFlag ? '1300' : '900';
    setInfoMessage(`✅ Визит завершён. Сумма к оплате: ${result.cost} ₽ (стоп-чек ${stopText} ₽). Нажмите «Оплатить», чтобы перейти в ЮKassa.`);
    showPaymentState({
        title: 'Ожидает оплаты',
        text: 'После оплаты в ЮKassa вы автоматически вернётесь на эту страницу.',
        tone: 'loading',
    });

    clearActiveVisit();
    updateUIByState();
    elements.payBtn.style.display = 'inline-flex';
}

async function redirectToYooKassa() {
    if (!state.pendingPayment) {
        setInfoMessage('Сначала завершите визит, чтобы рассчитать сумму к оплате.');
        return;
    }

    elements.payBtn.disabled = true;
    setInfoMessage('Сейчас откроется страница оплаты ЮKassa.');
    showPaymentState({
        title: 'Переход к оплате',
        text: 'Готовим платёж и открываем страницу ЮKassa.',
        tone: 'loading',
    });

    try {
        const returnToken = window.crypto.randomUUID();

        const payment = await fetchApi('/api/payments', {
            method: 'POST',
            body: JSON.stringify({
                amount: state.pendingPayment.cost,
                description: `Оплата визита в Козюкофе (${state.pendingPayment.totalMinutes} мин)`,
                returnToken,
                metadata: {
                    duration_minutes: String(state.pendingPayment.totalMinutes),
                    return_token: returnToken,
                },
            }),
        });

        state.pendingPayment.id = payment.id;
        savePendingPayment();

        if (!payment.confirmationUrl) {
            throw new Error('ЮKassa не вернула ссылку для оплаты');
        }

        window.location.href = payment.confirmationUrl;
    } catch (error) {
        elements.payBtn.disabled = false;
        setInfoMessage('Не удалось открыть страницу оплаты. Попробуйте ещё раз.');
        showPaymentState({
            title: 'Не удалось открыть оплату',
            text: error.message || 'Попробуйте повторить через несколько секунд.',
            tone: 'error',
        });
        showToast('Не удалось создать платеж', 'error');
    }
}

function updateCurrentTimeDisplay() {
    const now = new Date();
    const dayName = now.toLocaleDateString('ru-RU', { weekday: 'short' });
    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    elements.currentTimeDisplay.innerHTML = `<i class="far fa-clock"></i> ${dayName}, ${timeStr}`;
}

function restoreVisitFromStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
        return;
    }

    const parsedStart = new Date(stored);
    if (Number.isNaN(parsedStart.getTime())) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }

    const now = new Date();
    if (parsedStart.toDateString() !== now.toDateString() || !isWithinWorkingHours(parsedStart)) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }

    state.activeVisitStart = parsedStart;
    updateUIByState();
    setInfoMessage('⏳ Активный визит восстановлен. Нажмите «Завершить визит», когда покинете кафе.');
    hideVisitDetails();
}

function restorePendingPayment() {
    const storedPayment = localStorage.getItem(PENDING_PAYMENT_KEY);
    if (!storedPayment) {
        return;
    }

    try {
        const parsedPayment = JSON.parse(storedPayment);
        state.pendingPayment = {
            ...parsedPayment,
            startTime: new Date(parsedPayment.startTime),
            endTime: new Date(parsedPayment.endTime),
        };

        renderAmount(state.pendingPayment.cost);
        showVisitDetails(state.pendingPayment);
        elements.payBtn.style.display = 'inline-flex';
        showPaymentState({
            title: 'Ожидает оплаты',
            text: 'Платёж сохранён. Вы можете продолжить оплату в любой момент.',
            tone: 'loading',
        });
    } catch {
        localStorage.removeItem(PENDING_PAYMENT_KEY);
    }
}

async function handlePaymentReturn() {
    const currentUrl = new URL(window.location.href);
    const isPaymentReturn = currentUrl.searchParams.get('payment') === 'return';
    const returnToken = currentUrl.searchParams.get('payment_key');

    if (!isPaymentReturn) {
        return;
    }

    setInfoMessage('Проверяем результат оплаты...');
    showPaymentState({
        title: 'Проверяем оплату',
        text: 'Это займёт всего несколько секунд.',
        tone: 'loading',
    });

    try {
        if (!state.pendingPayment?.id && returnToken) {
            const lookupResult = await fetchApi(`/api/payments/lookup/${encodeURIComponent(returnToken)}`);
            state.pendingPayment = {
                ...(state.pendingPayment ?? {}),
                id: lookupResult.paymentId,
                cost: state.pendingPayment?.cost ?? 0,
                totalMinutes: state.pendingPayment?.totalMinutes ?? 0,
                startTime: state.pendingPayment?.startTime ?? new Date(),
                endTime: state.pendingPayment?.endTime ?? new Date(),
            };
            savePendingPayment();
        }

        if (!state.pendingPayment?.id) {
            throw new Error('Не удалось восстановить платёж после возврата из ЮKassa.');
        }

        const payment = await getPaymentStatusWithRetry(state.pendingPayment.id);

        currentUrl.searchParams.delete('payment');
        currentUrl.searchParams.delete('payment_key');
        window.history.replaceState({}, document.title, currentUrl.toString());

        if (payment.status === 'succeeded' || payment.paid) {
            resetPaymentState();
            setInfoMessage('Оплата прошла успешно. Спасибо за визит!');
            hideVisitDetails();
            renderAmount(0);
            showPaymentState({
                title: 'Оплата подтверждена',
                text: 'Спасибо за визит. Платёж успешно завершён.',
                tone: 'success',
            });
            showToast('Оплата прошла успешно');
            updateUIByState();
            return;
        }

        if (payment.status === 'canceled') {
            setInfoMessage('Оплата была отменена. Можно попробовать ещё раз.');
            showPaymentState({
                title: 'Оплата отменена',
                text: 'Можно вернуться к оплате, когда будете готовы.',
                tone: 'error',
            });
            showToast('Оплата была отменена', 'error');
            updateUIByState();
            return;
        }

        setInfoMessage('Платёж ещё обрабатывается. Статус обновится чуть позже.');
        showPaymentState({
            title: 'Платёж обрабатывается',
            text: 'ЮKassa ещё не прислала финальное подтверждение. Попробуйте обновить страницу немного позже.',
            tone: 'loading',
        });
        showToast('Платёж ещё обрабатывается', 'error');
        updateUIByState();
    } catch (error) {
        currentUrl.searchParams.delete('payment');
        currentUrl.searchParams.delete('payment_key');
        window.history.replaceState({}, document.title, currentUrl.toString());
        setInfoMessage('Не удалось проверить статус платежа.');
        showPaymentState({
            title: 'Не удалось проверить оплату',
            text: error.message || 'Попробуйте обновить страницу или повторить проверку позже.',
            tone: 'error',
        });
        showToast('Не удалось проверить статус платежа', 'error');
    }
}

function setupBeforeUnloadWarning() {
    window.addEventListener('beforeunload', (event) => {
        if (!state.activeVisitStart) {
            return;
        }

        const message = 'У вас активный визит! Не забудьте завершить его и оплатить.';
        event.preventDefault();
        event.returnValue = message;
        return message;
    });
}

function bindEvents() {
    elements.startBtn.addEventListener('click', startVisit);
    elements.endBtn.addEventListener('click', finishVisit);
    elements.payBtn.addEventListener('click', redirectToYooKassa);
}

async function init() {
    restoreVisitFromStorage();
    restorePendingPayment();
    updateUIByState();
    bindEvents();
    updateCurrentTimeDisplay();
    setInterval(updateCurrentTimeDisplay, 1000);
    setupBeforeUnloadWarning();
    await handlePaymentReturn();
}

init();
