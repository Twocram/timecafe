function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function isWithinWorkingHours(date) {
    const day = date.getDay();
    const timeInMinutes = date.getHours() * 60 + date.getMinutes();

    if (day === 0 || day === 6) {
        const startWork = 10 * 60;
        const endWork = 22 * 60;
        return timeInMinutes >= startWork && timeInMinutes < endWork;
    }

    const startWork = 12 * 60;
    const endWork = 22 * 60;
    return timeInMinutes >= startWork && timeInMinutes < endWork;
}

function getRateAtMoment(date) {
    if (isWeekend(date)) {
        return 4.0;
    }

    const totalMinutes = date.getHours() * 60 + date.getMinutes();
    if (totalMinutes >= 12 * 60 && totalMinutes < 16 * 60) {
        return 2.5;
    }
    if (totalMinutes >= 16 * 60 && totalMinutes < 22 * 60) {
        return 4.0;
    }

    return 0;
}

function calculateVisitCost(startDate, endDate, options = {}) {
    const { skipWorkingHoursCheck = false } = options;

    if (!startDate || !endDate) {
        return { cost: 0, error: 'Некорректные даты' };
    }

    if (startDate >= endDate) {
        return { cost: 0, error: 'Время окончания должно быть позже начала' };
    }

    if (!skipWorkingHoursCheck && !isWithinWorkingHours(startDate)) {
        return { cost: 0, error: 'Начало визита вне рабочего времени кафе' };
    }

    if (!skipWorkingHoursCheck && !isWithinWorkingHours(endDate)) {
        return { cost: 0, error: 'Завершение визита возможно только в рабочие часы (до 22:00)' };
    }

    if (!skipWorkingHoursCheck && startDate.toDateString() !== endDate.toDateString()) {
        return { cost: 0, error: 'Визит не может длиться дольше рабочего дня. Завершите визит до 22:00' };
    }

    const weekend = isWeekend(startDate);
    const totalMinutes = (endDate - startDate) / (1000 * 60);
    const firstHourCost = 300;
    let extraCost = 0;

    if (totalMinutes > 60) {
        const startOfExtra = new Date(startDate.getTime() + 60 * 60 * 1000);
        let currentMoment = new Date(startOfExtra);

        while (currentMoment < endDate) {
            extraCost += getRateAtMoment(currentMoment);
            currentMoment = new Date(currentMoment.getTime() + 60 * 1000);
        }
    }

    const totalRaw = firstHourCost + extraCost;
    const stopCheck = weekend ? 1300 : 900;
    const finalCost = Math.round(Math.min(totalRaw, stopCheck));

    return {
        cost: finalCost,
        error: null,
        totalMinutes: Math.floor(totalMinutes),
        startTime: startDate,
        endTime: endDate,
    };
}

export {
    calculateVisitCost,
    isWeekend,
    isWithinWorkingHours,
};
