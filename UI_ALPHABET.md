# CO-VA — Shared UI Alphabet

Этот документ фиксирует единый Shared UI-контракт CO-VA для professional и end-user интерфейсов.

После сверки с исходной утверждённой архитектурой, исторической реализацией Shared владельцев и текущими явно согласованными правилами этот документ является зафиксированным архитектурным контрактом для текущей Shared UI-коррекции. Runtime-код и проверки приводятся в соответствие с ним, а не наоборот.

## Общая схема

```text
H
├─ Header → A / B / C / D
├─ Y
├─ Z → Z Header / Z Body
└─ V

Q / X / S / Technical modal — Shared modal-механизмы.
F / E — Shared deck-system.
```

Professional и end-user используют одних Shared владельцев. Feature не создаёт локальную копию H, Header, Y, Z, V, Q, X, S, F/E, Calendar, DatePicker, TimePicker, Selector, Field, Textarea, ColorPicker, Button, swipe/dismiss или Shared list entry.

---

## H — поле приложения

H — постоянное поле приложения размером с реальный экран телефона.

- H начинается от верхней границы приложения и учитывает safe-area.
- H использует `var(--surface-dark)`.
- Минимальная ширина приложения — `320px`.
- Максимальная ширина ограничивается общим `--app-max-width`.
- H не прокручивается вместе с содержимым.
- H не меняет геометрию из-за Y, Z, Q, X, S, клавиатуры или длинного контента.
- APP shell целиком не превращается в обычную прокручиваемую страницу.
- Белого пустого пространства над H быть не должно.

Логика H:

```text
H → Header
H → Y
H → Z
H → V
```

---

## Header — A / B / C / D

Высота Shared Header — `72px`.

Shared grid:

- A: `52px`;
- B: оставшееся пространство;
- C: `auto`;
- D: `46px`;
- gap: `7px`;
- padding: `8px 10px`.

Узкий mobile viewport не создаёт другую архитектуру Header.

### A

**A = только photo.**

- фактическая фотография/аватар текущего контекста;
- `48 × 48px`;
- круг;
- контур `2px #FFFF00`.

**A ≠ settings.**

**A ≠ V.**

У A нет settings-tag, gear, menu, action, click-handler или зависимости от V.

### B

B — название текущего APP-контекста.

- `18px`;
- line-height около `1.1`;
- weight около `760`;
- white.

B не становится заголовком Q.

### C

C существует только когда текущему разделу нужен contextual `+`.

Если `+` не нужен — C отсутствует. Disabled placeholder не создаётся.

C не используется для Save / Apply / Confirm / Edit / Send / Book или завершения Q.

### D

D — единый Shared вход в Messenger.

- hit-area около `42 × 42px`;
- иконка белая;
- D не превращается в отдельную белую круглую кнопку.

Messenger stack-логика сохраняется.

---

## V — самостоятельный floating action

V — самостоятельный Shared плавающий элемент текущего раздела.

- V не является частью A;
- V не создаётся из A;
- V не зависит от состояния A;
- V не определяет Y;
- V не меняет геометрию H, Y или Z;
- feature передаёт только содержимое/действие Shared владельцу V.

---

## Y — универсальная Shared H-zone

**Y = универсальная Shared H-zone.**

Y находится после Header и перед Z:

```text
H
→ Header
→ Y
→ Z
```

Y не находится внутри Z, Z Header, Z Body, Journal или Note.

**Note ≠ Y.**

Note владеет только своим содержимым. Shared Y владеет зоной и может содержать Note или другие будущие элементы.

При появлении Y:

- H и Header не двигаются;
- нижняя граница H не двигается;
- Y занимает только свою фактическую высоту;
- Z начинается сразу после Y;
- доступная высота Z уменьшается ровно на высоту Y.

При исчезновении Y Z возвращается к baseline сразу после Header.

Feature-specific фиксированная высота Y запрещена.

---

## Z — единая Shared рабочая поверхность

Без Y:

- top — сразу после Header;
- left gap `16px`;
- width `100% - 16px`;
- bottom — нижняя граница H.

С Y top Z автоматически следует за фактической высотой Y; bottom не меняется.

Z:

- white;
- только верхний левый угол rounded;
- radius `34px`;
- остальные углы квадратные;
- padding-top `22px`;
- padding-left/right `18px`;
- padding-bottom `24px + safe-area`;
- Shared shadow.

Z состоит из:

```text
Z Header
Z Body
```

Z Body — основная вертикальная scroll-зона рабочего содержимого. H и весь APP shell не скроллятся.

Нижние actions, предусмотренные интерфейсом, остаются привязаны к нижней части рабочей поверхности и не уезжают вслед за длинным списком.

---

## Z2 / Z3

Z2/Z3 используют существующий Shared layer stack.

- следующий слой накладывается поверх предыдущего;
- предыдущий остаётся жив;
- dismiss выполняется по одному уровню;
- локальные feature-specific swipe implementations запрещены.

---

## Q — большой Shared context modal

Q имеет геометрию Z1 baseline:

- left `16px`;
- top — после Header `72px`;
- right — до правого края H;
- bottom — до нижнего края H.

**Q перекрывает Y.**

Y не добавляет Q-offset.

При открытом Q:

- B/C/D остаются APP Header под veil;
- элементы H под Q не получают interaction;
- tap-through запрещён;
- Q имеет собственные Q Header, Q Body и при необходимости Q Actions;
- Q title находится внутри Q Header.

Закрытие Q:

- tap по veil;
- Shared `[<]` внутри Q.

Главное действие Q находится внутри Q и не переносится в C.

---

## Keyboard / viewport

Открытие системной клавиатуры не меняет базовую геометрию H, Header, Z или Q.

Используется существующий Shared stable viewport mechanism. Новый keyboard/viewport runtime не создаётся.

Нижние actions Z/Q не поднимаются автоматически над клавиатурой. Поле ввода при необходимости прокручивается внутри своей рабочей scroll-зоны.

X сохраняет собственную утверждённую механику работы с полями и клавиатурой.

---

## X / S / Technical modal

### X

Shared bottom modal для selector, action list, editor, picker, небольших форм, TimePicker и ColorPicker.

Feature не создаёт собственную X-геометрию.

### S

Shared верхний информационный modal для информации, warning, error, факта, короткого report или receipt.

S не используется как сложная форма.

### Technical modal

Отдельный modal на чистом H:

- белый прямоугольный sticker;
- углы `90°`;
- минимум `25px` слева и справа;
- сверху и снизу виден H;
- закрытие `×`.

---

## F / E

F/E используют одну существующую Shared deck-system.

- F — горизонтальная навигация родительского уровня;
- E — вложенная вертикальная навигация;
- при Menu-состоянии Z скрывается по Shared архитектуре;
- существующую рабочую F/E механику не дублировать и не переписывать без доказанной необходимости.

---

## MiniCard

Shared MiniCard имеет фиксированную ширину `238px`.

MiniCard не заменяется шириной F-card.

---

## Shared controls

В приложении один Shared владелец для каждого назначения:

- Calendar;
- DatePicker;
- TimePicker;
- Selector;
- Field;
- Textarea;
- ColorPicker;
- Button;
- Shared list entry;
- swipe/dismiss.

Локальная копия уже существующего Shared primitive запрещена.

---

## Цвета

Shared tokens:

- H: `var(--surface-dark)`;
- Z/Q: `#FFFFFF`;
- primary: `#111111`;
- muted: `#777A7D`;
- disabled: `#D8D3CF`;
- yellow: `#FFFF00`;
- danger: `#FF1111`;
- danger text: `#FFFFFF`;
- Note default: `#CFC3FF`;
- F/E: `var(--button-secondary)`.

Бледно-розовый Shared danger не используется.

---

## Градиенты

Глобального запрета градиентов для всего APP UI нет.

Этот архитектурный контракт регулирует каркас H / Header / F / E / Y / Z / V / Q / X / S и не переписывает визуальные контракты компонентов наполнения.

Фон H и конкретные Shared поверхности используют только свои канонические token/background правила. MiniCard, EntityCard/Card, Chat content UI, Calendar content UI, поля, списки и другие component-owned UI сохраняют визуальные решения своих владельцев, включая градиенты, если они предусмотрены их собственным контрактом.

---

## Ownership

| Область | Shared owner |
|---|---|
| H / Header / Z / Z2 / Z3 / F / E / swipe | `ui/v2` |
| V | `ui/v2` |
| Y zone | `ui/v2` |
| Note content | `ui/note` |
| Q / X / S / Technical modal | `ui/modals` + `ui/v2` portal/layout |
| Calendar / DatePicker | `ui/calendar` |
| TimePicker | `ui/time` |
| Selector | `ui/selectors` |
| Field / Textarea | `ui/inputs` |
| ColorPicker | `ui/colors` |
| Button | `ui/buttons` |
| Shared list entry | `ui/lists` |

Shared UI един для professional и end-user.


---

## Полный реестр Shared UI owners

`ui/ui.js` — единый Shared UI facade.

- `ui/accordion`
- `ui/auth`
- `ui/booking`
- `ui/buttons`
- `ui/calendar`
- `ui/cards`
- `ui/chat`
- `ui/colors`
- `ui/cost`
- `ui/documents`
- `ui/duration`
- `ui/forms`
- `ui/header`
- `ui/info`
- `ui/inputs`
- `ui/layout`
- `ui/links`
- `ui/lists`
- `ui/modals`
- `ui/note`
- `ui/page`
- `ui/payment`
- `ui/profile`
- `ui/receipt`
- `ui/record`
- `ui/reference`
- `ui/repeated-fields`
- `ui/selection`
- `ui/selectors`
- `ui/settings`
- `ui/states`
- `ui/tags`
- `ui/time`
- `ui/uei`
- `ui/utils`
- `ui/v2`
- `ui/view-navigation`
- `ui/workplaces`


---

## Общие interaction-контракты

Контракт одинаков для профессионального интерфейса и интерфейса конечного пользователя.

B показывает только присвоенный текущему контексту заголовок; если заголовок контексту не присвоен, B может оставаться пустым.

В APP-состоянии D с иконкой чата всегда означает `включить Messenger`.
В корне Messenger Z1 D меняется на явный control `вернуться в приложение`.
Для обычного диалога D — скрепка/вложения.

Информационный control `I` всегда находится в правой зоне `Z Header`.

S — только информационное/техническое сообщение; сложные формы и editors принадлежат X/Q.

Текущее выбранное значение в закрытом select всегда визуально центрировано.

### Canonical Shared owner rows

| Shared primitive | Единственный owner |
|---|---|
| Calendar / DatePicker / DateNavigator | `ui/calendar` |
| Workplace selector / workplace controls | `ui/workplaces` |
