import { PENDING_PAYMENT_KEY, STORAGE_KEY } from './config.js';
import { calculateVisitCost, isWeekend, isWithinWorkingHours } from './pricing.js';

const elements = {
    startBtn: document.getElementById('startBtn'),
    endBtn: document.getElementById('endBtn'),
    payBtn: document.getElementById('payBtn'),
    customerName: document.getElementById('customerName'),
    customerNameDisplay: document.getElementById('customerNameDisplay'),
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
    activeVisitCustomerName: '',
    isTesting: false,
    pendingPayment: null,
};

function normalizeCustomerName(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getCustomerName() {
    return normalizeCustomerName(elements.customerName.value);
}

function hasCustomerName() {
    return getCustomerName().length > 0;
}

function setCustomerName(name) {
    elements.customerName.value = name ?? '';
}

function parseStoredDate(value) {
    if (!value) {
        return null;
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        return null;
    }

    return parsedDate;
}

function saveActiveVisit() {
    if (!state.activeVisitStart) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        startTime: state.activeVisitStart.toISOString(),
        customerName: state.activeVisitCustomerName,
    }));
}

async function loadAppConfig() {
    try {
        const config = await fetchApi('/api/config');
        state.isTesting = Boolean(config?.isTesting);
    } catch {
        state.isTesting = false;
    }
}

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

    elements.customerNameDisplay.textContent = result.customerName ?? 'Не указано';
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
        customerName: state.pendingPayment.customerName,
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
    state.activeVisitCustomerName = '';
    localStorage.removeItem(STORAGE_KEY);
}

function updateUIByState() {
    const isActive = state.activeVisitStart !== null;
    const hasPendingPayment = Boolean(state.pendingPayment);
    const canUseName = hasCustomerName();

    elements.customerName.disabled = isActive && Boolean(state.activeVisitCustomerName);

    if (isActive) {
        elements.statusLed.classList.add('active');
        const startTimeStr = state.activeVisitStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const visitCustomerName = state.activeVisitCustomerName || 'гость без имени';
        elements.statusText.innerHTML = `🟢 Визит активен: ${visitCustomerName} (начало в ${startTimeStr})`;
        elements.startBtn.disabled = true;
        elements.endBtn.disabled = false;
        elements.payBtn.disabled = true;
        return;
    }

    elements.statusLed.classList.remove('active');
    elements.statusText.innerHTML = hasPendingPayment
        ? '🟡 Есть неоплаченный завершённый визит'
        : '⚪ Нет активного визита';
    elements.startBtn.disabled = hasPendingPayment || !canUseName;
    elements.endBtn.disabled = true;
    elements.payBtn.disabled = !state.pendingPayment || !canUseName;
}

function startVisit() {
    if (state.activeVisitStart) {
        setInfoMessage('Визит уже активен. Завершите текущий, чтобы начать новый.');
        return;
    }

    if (state.pendingPayment) {
        setInfoMessage('Сначала оплатите уже завершённый визит, чтобы не потерять его.');
        return;
    }

    const customerName = getCustomerName();
    if (!customerName) {
        setInfoMessage('Введите имя гостя перед началом визита.');
        return;
    }

    const now = new Date();
    if (!state.isTesting && !isWithinWorkingHours(now)) {
        setInfoMessage('⏰ Кафе сейчас закрыто. Расписание: выходные 10:00–22:00, будни 12:00–22:00.');
        return;
    }

    state.activeVisitStart = now;
    state.activeVisitCustomerName = customerName;
    saveActiveVisit();
    resetPaymentState();
    updateUIByState();
    setInfoMessage(`🎉 Визит для гостя ${customerName} начат! Не забудьте нажать «Завершить визит» при выходе.`);
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

    const result = calculateVisitCost(state.activeVisitStart, new Date(), {
        skipWorkingHoursCheck: state.isTesting,
    });
    if (result.error) {
        setInfoMessage(`❌ Ошибка: ${result.error}`);
        renderAmount(0);
        hideVisitDetails();
        return;
    }

    const customerName = state.activeVisitCustomerName || getCustomerName();
    if (!customerName) {
        setInfoMessage('Введите имя гостя перед завершением визита.');
        return;
    }

    renderAmount(result.cost);
    state.pendingPayment = {
        ...result,
        customerName,
    };
    savePendingPayment();
    showVisitDetails(state.pendingPayment);

    const weekendFlag = isWeekend(state.activeVisitStart);
    const stopText = weekendFlag ? '1300' : '900';
    setInfoMessage(`✅ Визит гостя ${state.pendingPayment.customerName} завершён. Сумма к оплате: ${result.cost} ₽ (стоп-чек ${stopText} ₽). Нажмите «Оплатить», чтобы перейти в ЮKassa.`);
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

    const customerName = getCustomerName();
    if (!customerName) {
        setInfoMessage('Введите имя гостя перед оплатой.');
        return;
    }

    state.pendingPayment.customerName = customerName;
    savePendingPayment();

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
                description: `Оплата визита в Козюкофе: ${customerName} (${state.pendingPayment.totalMinutes} мин)`,
                customerName,
                returnToken,
                metadata: {
                    customer_name: customerName,
                    duration_minutes: String(state.pendingPayment.totalMinutes),
                    return_token: returnToken,
                    visit_start: state.pendingPayment.startTime.toISOString(),
                    visit_end: state.pendingPayment.endTime.toISOString(),
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

    let parsedStart = null;
    let customerName = '';

    try {
        const parsed = JSON.parse(stored);
        parsedStart = parseStoredDate(parsed.startTime);
        customerName = normalizeCustomerName(parsed.customerName);
    } catch {
        parsedStart = parseStoredDate(stored);
    }

    if (!parsedStart) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }

    const now = new Date();
    if (
        (!state.isTesting && parsedStart.toDateString() !== now.toDateString())
        || (!state.isTesting && !isWithinWorkingHours(parsedStart))
    ) {
        localStorage.removeItem(STORAGE_KEY);
        return;
    }

    state.activeVisitStart = parsedStart;
    state.activeVisitCustomerName = customerName;
    if (customerName) {
        setCustomerName(customerName);
    }
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
            customerName: normalizeCustomerName(parsedPayment.customerName),
            startTime: parseStoredDate(parsedPayment.startTime) ?? new Date(),
            endTime: parseStoredDate(parsedPayment.endTime) ?? new Date(),
        };

        if (state.pendingPayment.customerName) {
            setCustomerName(state.pendingPayment.customerName);
        }
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
                customerName: state.pendingPayment?.customerName ?? normalizeCustomerName(lookupResult.customerName),
                cost: state.pendingPayment?.cost ?? lookupResult.amount ?? 0,
                totalMinutes: state.pendingPayment?.totalMinutes ?? Number(lookupResult.metadata?.duration_minutes ?? 0),
                startTime: state.pendingPayment?.startTime ?? parseStoredDate(lookupResult.metadata?.visit_start) ?? new Date(),
                endTime: state.pendingPayment?.endTime ?? parseStoredDate(lookupResult.metadata?.visit_end) ?? new Date(),
            };
            if (state.pendingPayment.customerName) {
                setCustomerName(state.pendingPayment.customerName);
            }
            savePendingPayment();
            renderAmount(state.pendingPayment.cost);
            showVisitDetails(state.pendingPayment);
            elements.payBtn.style.display = 'inline-flex';
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
            setCustomerName('');
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

function handleCustomerNameInput() {
    const customerName = getCustomerName();

    if (state.activeVisitStart && !state.activeVisitCustomerName && customerName) {
        state.activeVisitCustomerName = customerName;
        saveActiveVisit();
    }

    if (state.pendingPayment) {
        state.pendingPayment.customerName = customerName;
        savePendingPayment();
        showVisitDetails(state.pendingPayment);
    }

    updateUIByState();
}

function bindEvents() {
    elements.startBtn.addEventListener('click', startVisit);
    elements.endBtn.addEventListener('click', finishVisit);
    elements.payBtn.addEventListener('click', redirectToYooKassa);
    elements.customerName.addEventListener('input', handleCustomerNameInput);
}

async function init() {
    await loadAppConfig();
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
