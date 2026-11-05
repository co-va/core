# PROJECT_STATE

## Обязательный контракт

- Рабочая ветка только `staging`. Production только `main`. Другие рабочие ветки запрещены.
- Новый функционал собирается из существующего Shared UI по `UI_ALPHABET.md`. Локальный клон существующего UI запрещён.
- Бизнес-классификация F/E, главный рабочий контур, условная видимость инструментов и правило `capability != F` определяются только `BUSINESS_ARCHITECTURE.md`. Новый F/E нельзя добавлять под отдельную профессию в обход этого реестра.
- F/E/Z, свайпы, CardDeck, modal geometry и viewport geometry имеют одного владельца: Shared UI.
- Feature-код не создаёт собственный глобальный pointer/touch owner, fixed/full-screen слой, modal geometry или canonical component CSS.
- A/B/C/D, F/E/Z, Q/X/S, CardDeck, EntityCard, miniCard, v2ListEntry/v2ListEntries, Calendar, TimePicker, Receipt и Document используются только через Shared UI.
- Runtime `legacy`, `bridge`, `compat`, `migration`, migrate/verify/bootstrap-переходы запрещены. Исторические Prisma migrations сохраняются как история БД и не являются runtime.
- Бизнес-данные принадлежат серверу/PostgreSQL. Browser storage — только session/technical/UI state.
- Новое общее UI-проявление сначала создаётся в Shared UI и получает guard/test; только потом используется инструментом.
- CI обязан падать при попытке вернуть запрещённую архитектуру.
- Перед `main`: `npm run check`, `npm test`, browser runtime tests и фактическая проверка затронутых контуров.

## Граница User / Core

- Приложение конечного пользователя имеет единственного владельца: `co-va/user`.
- `co-va/core` НЕ является приложением конечного пользователя.
- Для `co-va/user` этот репозиторий владеет только backend/API/server logic/Prisma/PostgreSQL и общими серверными контрактами.
- User frontend/runtime/routes/UI должны быть полностью удалены из Core отдельным этапом после установки защиты User; возвращать их в Core запрещено.
- Удаление User из Core не означает удаление API, серверной логики, Prisma или данных, необходимых `co-va/user`.
- Professional и другие продуктовые контуры не переписываются в рамках удаления User.
- Этапный план ведётся в `co-va/user/PROJECT_STATE.md`. Следующий исполнитель не создаёт новый план, а продолжает с первого незавершённого этапа этого плана.

### Зафиксированное состояние отделения User — 2026-11-04

- `co-va/user` — единственный репозиторий приложения конечного пользователя; его рабочий код и домен не менялись в рамках этой очистки.
- В `co-va/core/staging` удалены прежние User HTML/JS entry, Account Shell, User runtime/route/client-side UI, их отдельные CSS/PWA assets и тесты, требовавшие старый User UI внутри Core.
- `co-va/core` остаётся владельцем backend/API/Prisma/PostgreSQL и общих серверных контрактов Account, Record, Consent, Messenger, Notifications. Эти контракты не удалять по имени `Account` без анализа потребителей.
- `Professional` **пока работает из Core** и не переключён на отдельный домен. Его `core.js`, Journal, Shared UI, Professional Push, Backend и Public Booking `online-booking/access.js` + `online-booking/booking-entry.js` сохраняются до отдельного подтверждённого переключения.
- Обработчик `USER_HOST` в сервере Core временно сохраняет только гостевой Public Booking на старом host для совместимости, **не User App**. Его удаление — только после проверки действующих ссылок и маршрутов.
- **Отдельное незакрытое расхождение маршрутов:** `settings/online-booking/online-booking.js` в Core формирует URL на `user.va-tools.ru/<profileSlug>`, хотя перенесённый User-домен уже принадлежит отдельному приложению. Риск маршрутизации существующих/новых ссылок требует отдельного решения с проверкой реального домена. В этой очистке ссылки и маршруты публичной записи не менялись.
- Проверки после удаления User в `core/staging` на коммите `69ed0d2`: `check` PASS, `staging-smoke` PASS, `modal-browser-interaction` PASS, `onboarding-smoke` PASS. После документационного коммита эти же проверки должны оставаться зелёными.
- `core/main` не изменён. Перенос `staging → main` разрешён только отдельным подтверждённым PR после проверок; автоматический merge не делать.

## Task Scope Gate

- Пользователь описывает желаемый результат и не обязан определять технический контур задачи.
- До первой правки исполнитель обязан сам классифицировать текущий этап, зафиксировать один активный contour и ограниченный ALLOW-набор файлов/директорий через Task Scope Gate.
- Найденная необходимость изменить другой contour не расширяет текущий scope. Такое изменение фиксируется как dependency/handoff и выполняется только отдельным следующим этапом с новым scope.
- Запрещено делать изменения «заодно», даже если исполнитель считает соседний код неправильным.
- Scope фиксируется на чистом `staging` до первой правки и привязывается к текущему HEAD. После lock изменение scope запрещено; расширение требует завершения текущего этапа и нового scope.
- Перед коммитом и перед завершением этапа обязателен `npm run check:scope`. Любой файл вне ALLOW или внутри DENY является `SCOPE VIOLATION`; задача не считается выполненной.
- `npm run check:scope` не заменяет `npm run check`, `npm test`, browser/runtime checks и Check Book; он проверяет только границы текущего этапа.

## Репозитории и защищённый merge

- Проект разделён на несколько рабочих репозиториев организации `co-va`; нельзя считать `co-va/core` владельцем всех приложений.
- `co-va/core` — backend/API/DB и оставшиеся Core-контуры до их отдельного выделения.
- `co-va/user` — единственное приложение конечного пользователя.
- `3001vaf-maker` — рабочий аккаунт исполнителя, а не владелец репозитория. Проект нельзя искать или подменять личным репозиторием `3001vaf-maker`.
- Если GitHub-подключение не показывает нужный проект через профиль исполнителя, сначала обращаться к точному репозиторию организации `co-va` или его URL. Если точный репозиторий всё равно недоступен, остановиться и сообщить о проблеме подключения; не выдумывать пути, файлы или другой репозиторий.
- `co-tools` — администратор и Code Owner защищённых файлов.
- Если GitHub запросил review от `co-tools`, это штатный архитектурный шлагбаум. Его нельзя обходить, отключать или менять ради merge.
- При таком шлагбауме исполнитель сам доводит PR и CI до зелёного состояния, после чего от пользователя требуется только `Approve` → `Submit review` под `co-tools`.
- После одобрения исполнитель сам выполняет merge в `main` и синхронизирует `staging`; пользователь не должен вручную делать merge.

## Владение F/E и D

- `Профиль` — самостоятельная F и имеет единственного владельца `core/profile`. `Настройки` не владеют Профилем и не могут содержать его alias, bridge или прокси-модуль.
- `Сервис` — самостоятельная F и имеет единственного владельца `core/service`. `Настройки` не владеют Сервисом и не могут содержать его alias, bridge или прокси-модуль.
- F `Настройки` содержит только свои E: `Онлайн-запись`, `Уведомления`, `Интеграции`, `Документы`, `Ярлыки`, `Перенос данных`; добавление `Профиль` или `Сервис` в реестр `settings` запрещено даже как скрытый пункт.
- Shared `CardDeck` обязан рендерить все разрешённые реальные F без числового лимита; появление нового корневого раздела не может скрывать последний F.
- F `Финансы` владеет E `Касса`, `ДДС`, `Z-отчёт`.
- F `Склад` владеет E `Остатки`, `Движения`, `Заказ`, `Инвентаризация`.
- D `Чат` — глобальный application layer, а не F/E. Он сохраняет контекст возврата и может открываться из разных контуров; ни одна F/E не становится владельцем чата.
- Возврат Профиля или Сервиса под `Настройки`, а также включение D `Чат` в `ROOT_SECTIONS`, является архитектурной регрессией и блокируется CI.

## CSS-граница

- В основном приложении CSS разрешён только в `ui/**` и фундаментальном `css/style.css`.
- Изолированные entry-поверхности `admin/admin.css` и `invite/invite.css` не являются Shared UI и не могут импортироваться рабочими инструментами.
- Новый feature-CSS вне Shared UI запрещён.

- Мёртвый runtime JS запрещён: каждый JS-модуль должен быть достижим от реального HTML-entry или `service-worker.js`.

- UI owner без регистрации в `UI_ALPHABET.md` запрещён. Новый `ui/<owner>` не проходит CI, пока не описан и не защищён guard/test.

## Handoff: График как режим Журнала — 2026-11-05

- Новая утверждённая архитектура: один календарь «Журнал → Месяц» с режимами просмотра и управления Графиком, без отдельной F-карточки.
- В `co-va/professional/staging` прежняя F-карточка удалена, а режим графика перенесён в `journal/график.js`; оба режима используют один Shared Calendar. Владельцы расписания `timetable/day-editor.js` и `core/day/*` остаются едиными.
- В `co-va/core/staging` обновлены `BUSINESS_ARCHITECTURE.md`, `admin/commercial-catalog.js` и `server/src/saas-admin/commercial-catalog.service.ts`: администратор видит График как режим Журнала. Идентификаторы `timetable.access`, `cabinet.timetable`, `tool.timetable` сохраняются как права/учётные ключи, **не** как F.
- **Незакрытый инфраструктурный остаток:** Core пока содержит старый Professional frontend `core.js` и `timetable/timetable.js`, где ещё существует отдельный F-вход. Это не второй утверждённый владелец: данный runtime удаляется **целиком**, а не переписывается второй раз, после подтверждения, что действующий домен, вход, Journal, Booking, уведомления и API работают из самостоятельного `co-va/professional/staging`.
- До подтверждения переключения Core legacy Professional удалять нельзя, чтобы не оборвать действующих пользователей. Удаление провести отдельным закрытым scope с проверкой runtime, ссылок и всех entry/import; backend/API/DB сохранить.
- Закрытие миграции требует двух доказательств: работа независимого Professional из нового origin и отсутствие старых F-маршрутов/модулей в итоговом Core runtime. Сейчас второе **не выполнено**.

## Domain cutover handoff — `prof.va-tools.ru` (2026-11-05)

- Core `server/src/main.ts`: added `https://prof.va-tools.ru` to production CORS for the independent `co-va/professional/staging`. No change to backend API/business logic, old host routing or data.
- The old `app.va-tools.ru` is still temporarily served by Core, only until the replacement origin passes real live checks. This is NOT the target final state. Professional has updated its canonical `APP_ORIGIN` and Nginx host in its own repository.
- **After independent Professional validation:** replace Core's legacy `APP_HOST` and `TEMP_APP_HOST` static hosting with redirect/retirement; replace `https://app.va-tools.ru` in `server/src/password-reset/password-reset.service.ts` and `server/src/tenant-invitation/tenant-invitation.service.ts` (check `FRONTEND_ORIGIN` override), then remove leftover legacy Professional UI/assets while preserving server API/DB/Admin/Landing and public booking links. Never leave two independent working Professional frontends. Do not prematurely remove old access for active users.
