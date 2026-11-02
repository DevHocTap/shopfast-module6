const currency = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const time = new Intl.DateTimeFormat('vi-VN', { timeStyle: 'medium' });

export const formatVND = (amount: number): string => currency.format(amount);

export const formatDateTime = (value: string | Date): string => dateTime.format(new Date(value));

export const formatTime = (value: string | Date): string => time.format(new Date(value));
