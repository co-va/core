import type { MessagePurpose } from '../communication/message-purpose';

export type NotificationEventDefinition = {
  type: string;
  group: string;
  title: string;
  description: string;
  defaultTitle: string;
  defaultBody: string;
  variables: string[];
  purpose: MessagePurpose;
};

type NotificationEventDefinitionInput = Omit<NotificationEventDefinition, 'purpose'>;

function serviceEvent(definition: NotificationEventDefinitionInput): NotificationEventDefinition {
  return Object.freeze({ ...definition, purpose: 'SERVICE' as const });
}

export const NOTIFICATION_EVENT_CATALOG: readonly NotificationEventDefinition[] = Object.freeze([
  serviceEvent({
    type: 'booking.created',
    group: 'Запись',
    title: 'Запись создана',
    description: 'После создания записи',
    defaultTitle: 'Запись создана',
    defaultBody: 'Запись создана на {{date}} в {{time}}.',
    variables: ['date', 'time', 'workplace', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'booking.rescheduled',
    group: 'Запись',
    title: 'Запись перенесена',
    description: 'После изменения даты или времени',
    defaultTitle: 'Запись перенесена',
    defaultBody: 'Запись перенесена на {{date}} в {{time}}.',
    variables: ['date', 'time', 'workplace', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'booking.cancelled',
    group: 'Запись',
    title: 'Запись отменена',
    description: 'После отмены записи',
    defaultTitle: 'Запись отменена',
    defaultBody: 'Запись на {{date}} в {{time}} отменена.',
    variables: ['date', 'time', 'workplace', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'booking.deleted',
    group: 'Запись',
    title: 'Запись удалена',
    description: 'После полного удаления записи',
    defaultTitle: 'Запись удалена',
    defaultBody: 'Запись на {{date}} в {{time}} удалена.',
    variables: ['date', 'time', 'workplace', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'booking.confirmed',
    group: 'Запись',
    title: 'Запись подтверждена',
    description: 'После подтверждения записи',
    defaultTitle: 'Запись подтверждена',
    defaultBody: 'Запись на {{date}} в {{time}} подтверждена.',
    variables: ['date', 'time', 'workplace', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'booking.no-show',
    group: 'Запись',
    title: 'Неявка на запись',
    description: 'После отметки неявки',
    defaultTitle: 'Запись не состоялась',
    defaultBody: 'Запись {{date}} в {{time}} отмечена как не состоявшаяся.',
    variables: ['date', 'time', 'workplace', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'booking.reminder',
    group: 'Запись',
    title: 'Напоминание о записи',
    description: 'Перед предстоящей записью',
    defaultTitle: 'Напоминание о записи',
    defaultBody: 'Напоминаем о записи {{date}} в {{time}}.',
    variables: ['date', 'time', 'workplace', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'finance.payment',
    group: 'Финансы',
    title: 'Оплата проведена',
    description: 'После оплаты услуги или продажи',
    defaultTitle: 'Оплата проведена',
    defaultBody: 'Оплата на сумму {{amount}} проведена.',
    variables: ['amount', 'date', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'finance.refund',
    group: 'Финансы',
    title: 'Возврат проведён',
    description: 'После возврата оплаты',
    defaultTitle: 'Возврат проведён',
    defaultBody: 'Возврат на сумму {{amount}} проведён.',
    variables: ['amount', 'date', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'loyalty.changed',
    group: 'Лояльность',
    title: 'Программа лояльности изменена',
    description: 'После назначения или изменения программы лояльности',
    defaultTitle: 'Программа лояльности',
    defaultBody: 'Для вас изменена программа лояльности {{program}}.',
    variables: ['program', 'date', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'personal-account.changed',
    group: 'Личный счёт',
    title: 'Личный счёт или задолженность изменены',
    description: 'После изменения личного счёта или задолженности',
    defaultTitle: 'Личный счёт',
    defaultBody: 'По вашему личному счёту произошло изменение.',
    variables: ['amount', 'date', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'investment.participation',
    group: 'Инвестиции',
    title: 'Участие в инвестиции',
    description: 'После предложения участия или решения участника',
    defaultTitle: 'Участие в инвестиции',
    defaultBody: 'Изменился статус участия в инвестиции {{investment}}.',
    variables: ['investment', 'status', 'date', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'consent.accepted',
    group: 'Документы и согласия',
    title: 'Согласие принято',
    description: 'После принятия согласия',
    defaultTitle: 'Согласие принято',
    defaultBody: 'Согласие «{{document}}» принято.',
    variables: ['document', 'date', 'person.name', 'person.surname'],
  }),
  serviceEvent({
    type: 'consent.revoked',
    group: 'Документы и согласия',
    title: 'Согласие отозвано',
    description: 'После отзыва согласия',
    defaultTitle: 'Согласие отозвано',
    defaultBody: 'Согласие «{{document}}» отозвано.',
    variables: ['document', 'date', 'person.name', 'person.surname'],
  }),
]);

export const NOTIFICATION_EVENT_TYPES = Object.freeze(NOTIFICATION_EVENT_CATALOG.map((event) => event.type));

export function notificationEventDefinition(eventType: string) {
  return NOTIFICATION_EVENT_CATALOG.find((event) => event.type === eventType) || null;
}
