export function zonedDateTimeToDate(value: unknown, timeZone?: string): Date | null;

export function zonedDateTimeParts(value?: unknown, timeZone?: string): {date:string;time:string;hour:number;minute:number;second:number;minuteOfDay:number};
export function recordPaymentCalendarPhase(visitDate: unknown, at?: Date|string|number, timeZone?: string): 'before'|'on'|'after'|'';
