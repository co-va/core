// Core owns the target operational coverage catalogue. This is not AdminToolReadiness.
export const COVERAGE_VERSION = 1;
export const MECHANISMS = [
  [
    "workspace",
    "Рабочие пространства",
    "Профиль → рабочие пространства",
    [
      [
        "workspace.profile",
        "Создание, изменение и выбор пространства",
        "start.profile",
        {
          "state": "verify",
          "finding": "Создание, изменение и удаление пространства существуют.",
          "next": "Проверить сохранение, повторный вход и выбор пространства.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/profile/workplaces/data.js"
          }
        }
      ],
      [
        "workspace.multiple",
        "Работа в нескольких пространствах без смешивания данных",
        null,
        {
          "state": "verify",
          "finding": "Есть привязки услуг, график и фильтрация записи по пространству.",
          "next": "Подтвердить независимые графики, записи и услуги в двух пространствах.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/profile/profile.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "workspace-relations",
    "Условия деятельности",
    "Профиль → рабочее пространство (целевое место)",
    [
      [
        "relations.types",
        "Владение, аренда и найм как отношения участника с пространством",
        null,
        {
          "state": "investigate",
          "finding": "В модели пространства есть профиль, но отдельные отношения владения, аренды и найма не найдены.",
          "next": "Определить и реализовать связь участника с пространством, не создавая разные виды пространств.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ],
      [
        "relations.terms",
        "Стоимость, период, доступ и финансовые последствия",
        null,
        {
          "state": "investigate",
          "finding": "В модели пространства не найдены договорные сроки и стоимость пользования.",
          "next": "Определить условия аренды/найма, период и финансовое последствие.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ]
    ]
  ],
  [
    "participants",
    "Участники",
    "Место в UI требует согласования",
    [
      [
        "participants.identities",
        "Владелец, ассистент, продавец и исполнитель с единой идентичностью",
        null,
        {
          "state": "finish",
          "finding": "Есть аккаунт и Membership; отдельный операционный состав исполнителей не подтверждён.",
          "next": "Обеспечить участие владельца, ассистента и продавца в одном рабочем процессе.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ],
      [
        "participants.attribution",
        "Фиксация фактических участников каждой операции",
        null,
        {
          "state": "finish",
          "finding": "Есть авторство истории; участники групповой записи — получатели услуги, не исполнители.",
          "next": "Разделить автора изменения, исполнителя и получателя услуги; сохранять фактического участника операции.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/record/record.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "permissions",
    "Права и полномочия",
    "Место в UI требует согласования",
    [
      [
        "permissions.scope",
        "Полномочия по участнику и пространству",
        null,
        {
          "state": "finish",
          "finding": "Membership привязан к организации; отдельные полномочия в пространстве не подтверждены.",
          "next": "Проверить и дополнить разграничение по человеку, пространству и действию.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ],
      [
        "permissions.enforcement",
        "Серверная проверка доступа и изоляции данных",
        null,
        {
          "state": "verify",
          "finding": "Серверные проверки изоляции и прав уже есть.",
          "next": "Подтвердить запрет чужого доступа к записи, контакту и деньгам.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/saas-access/saas-access.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "resources",
    "Ресурсы",
    "Операционный домен → Ресурсы (если самостоятельный процесс)",
    [
      [
        "resources.catalog",
        "Ресурс, количество, состояние и доступность",
        null,
        {
          "state": "finish",
          "finding": "Учёт складского ресурса и его использования существует; это не календарная доступность оборудования.",
          "next": "Определить единый рабочий ресурс с доступностью для услуги, не дублируя складскую единицу.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ],
      [
        "resources.conflicts",
        "Блокировка пересечений и занятости ресурсов независимо от исполнителя",
        null,
        {
          "state": "investigate",
          "finding": "Проверка времени существует; независимая блокировка ресурса не подтверждена.",
          "next": "Проверить бронирование кресла/оборудования независимо от исполнителя.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/time/time.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "time",
    "Время и смены",
    "Журнал → Месяц → График; смены — место требует согласования",
    [
      [
        "time.timeline",
        "Шкала времени и слоты Professional",
        "journal.timeline",
        {
          "state": "verify",
          "finding": "Есть расчёт времени, доступность и построение слотов.",
          "next": "Проверить границы дня, пересечения, перенос и произвольную минуту.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/time/availability.js"
          }
        }
      ],
      [
        "time.schedule",
        "Рабочие дни Professional",
        "journal.graph",
        {
          "state": "verify",
          "finding": "График существует; ранее проверены сценарии отдельных пространств.",
          "next": "Подтвердить сохранение рабочих дней и влияние на доступное время.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/workplace-time.js"
          }
        }
      ],
      [
        "time.shifts",
        "Смены и фактически отработанное время участников независимо от Журнала",
        null,
        {
          "state": "investigate",
          "finding": "Рабочие интервалы пространства есть; самостоятельный учёт смен не подтверждён.",
          "next": "Разделить доступность для записи и фактически отработанное время участника.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ]
    ]
  ],
  [
    "contacts",
    "Контакты",
    "Контакты",
    [
      [
        "contacts.prof",
        "Рабочий контур контактов Professional",
        "start.contacts",
        {
          "state": "verify",
          "finding": "Есть создание, изменение, фильтры и импорт. Исправлено преждевременное подтверждение ручного создания.",
          "next": "Проверить создание/изменение, отказ сервера, повторный вход и сохранность контакта.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/people/create.js"
          }
        }
      ],
      [
        "contacts.core",
        "Единая идентичность, история и изоляция контактов в Core/User",
        null,
        {
          "state": "verify",
          "finding": "Проверки импорта, идентичности и сохранения существующих данных прошли.",
          "next": "Подтвердить единый контакт при регистрации, ручном добавлении, импорте и изменении.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/business-state/business-state.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "services",
    "Услуги",
    "Сервис → Услуги",
    [
      [
        "catalog.prof",
        "Каталог услуг и товаров Professional (общий критерий)",
        "start.service",
        {
          "state": "verify",
          "finding": "Каталог услуг и товаров ранее принят владельцем.",
          "next": "Не повторять приёмку без изменения принятого контура или обнаруженной регрессии.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "RELEASE_CLOSURE_REGISTRY.json"
          }
        }
      ],
      [
        "services.core",
        "Серверное сохранение цены, длительности и условий услуги",
        null,
        {
          "state": "verify",
          "finding": "Серверная цена, длительность и снимок услуги существуют.",
          "next": "Проверить неизменность прежней записи после изменения прайса и условий.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/record/record.service.ts"
          }
        }
      ],
      [
        "services.execution",
        "Сквозное оказание услуги, завершение и расчёт",
        null,
        {
          "state": "verify",
          "finding": "Запись, расход и расчёт существуют; полный единый рабочий проход ещё не подтверждён.",
          "next": "Пройти запись → выполнение → расход → оплата → история, включая отказ и возврат.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/record/record.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "service-stages",
    "Этапы исполнения",
    "Сервис → услуга; Журнал → запись (целевые места)",
    [
      [
        "stages.plan",
        "План этапов, длительность, исполнители и ресурсы",
        null,
        {
          "state": "investigate",
          "finding": "В проверенном Record не найден отдельный план этапов с назначением исполнителя и ресурса.",
          "next": "Реализовать план этапов одной услуги после проверки зависимостей участников и ресурсов.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/record/record.service.ts"
          }
        }
      ],
      [
        "stages.actual",
        "Фактическое исполнение, параллельность и изменение этапов",
        null,
        {
          "state": "investigate",
          "finding": "Сквозное исполнение нескольких этапов с параллельностью не подтверждено.",
          "next": "Учитывать фактическое начало и завершение этапов, замену исполнителя и занятость ресурса.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/record/record.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "products",
    "Товары",
    "Сервис → Товары; Склад",
    [
      [
        "catalog.prof",
        "Каталог услуг и товаров Professional (общий критерий)",
        "start.service",
        {
          "state": "verify",
          "finding": "Каталог услуг и товаров ранее принят владельцем.",
          "next": "Не повторять приёмку без изменения принятого контура или обнаруженной регрессии.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "RELEASE_CLOSURE_REGISTRY.json"
          }
        }
      ],
      [
        "products.identity",
        "Серверная связь товарной и складской единицы без дублей",
        null,
        {
          "state": "verify",
          "finding": "Каталог и складская единица связаны; владелец принимал этот контур.",
          "next": "Подтвердить одну позицию при создании, изменении цены и снятии с продажи.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/service/products/data.js"
          }
        }
      ],
      [
        "products.price",
        "Цена продажи, остаток, единицы и история изменений",
        null,
        {
          "state": "verify",
          "finding": "Учёт цены, складских единиц и стоимости движений существует.",
          "next": "Проверить единицы продажи, неизменность исторической цены и списание фактического количества.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/inventory/inventory.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "sales",
    "Продажи",
    "Продажа из Журнала; самостоятельная E/F Продажи",
    [
      [
        "sales.outside",
        "Продажа вне записи и её оплата Professional",
        "start.sale-outside",
        {
          "state": "investigate",
          "finding": "Есть общий выбор товара и продажа из записи; законченный маршрут вне записи не подтверждён.",
          "next": "Проверить фактическую отдельную продажу с оплатой и движением остатка.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/sale/sale.js"
          }
        }
      ],
      [
        "sales.standalone",
        "Рабочий цикл торговли без Журнала, в том числе обезличенная продажа",
        null,
        {
          "state": "finish",
          "finding": "Действующий код продажи связан с записью; самостоятельный торговый контур не подтверждён.",
          "next": "Завершить продажу без обязательной записи и без обязательного контакта.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/sale/sale.js"
          }
        }
      ],
      [
        "sales.settlement",
        "Оплата, возврат, складское движение и участник продажи",
        null,
        {
          "state": "finish",
          "finding": "Оплата и возврат, складские движения продажи из записи существуют.",
          "next": "Проверить отдельную продажу, частичный возврат, остаток и фактического продавца.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/finance/payment-settlement.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "records",
    "Журнал и онлайн-запись",
    "Журнал → День / Месяц / Список; Настройки → Онлайн-запись",
    [
      [
        "records.prof",
        "Журнал Professional",
        "start.journal",
        {
          "state": "verify",
          "finding": "Журнал и ряд действий ранее приняты; формальная приёмка всего контура не завершена.",
          "next": "Не повторять принятый UI; подтвердить оставшиеся операции и сохранение результата.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "RELEASE_CLOSURE_REGISTRY.json"
          }
        }
      ],
      [
        "records.user",
        "Авторизованный сквозной путь записи User",
        null,
        {
          "state": "verify",
          "finding": "Маршрут создания записи и браузерная проверка списка существуют.",
          "next": "Подтвердить запись, перенос, отмену и повтор в связке с Professional.",
          "source": {
            "repo": "user",
            "sha": "6d6358aca6e329c64698a82bc1f52c89f6c472c0",
            "path": "core/record/platform-api.js"
          }
        }
      ],
      [
        "records.core",
        "Единый Record/Time: доступность, изменения, история и конфликты",
        null,
        {
          "state": "verify",
          "finding": "Серверные создание, доступность и история реализованы.",
          "next": "Подтвердить конфликты времени, отмену, перенос и изоляцию в реальной связке.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/record/record.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "inventory",
    "Склад",
    "Склад → Остатки / Движения / Заказ поставщику / Инвентаризация",
    [
      [
        "inventory.stock",
        "Поступление, расход, продажа, перемещение и остатки",
        null,
        {
          "state": "verify",
          "finding": "Поступление, расход, продажа, перемещение и перерасчёт остатков реализованы.",
          "next": "Проверить последовательность движений и отсутствие дублей, включая единицы и стоимость.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/inventory/inventory.service.ts"
          }
        }
      ],
      [
        "inventory.count",
        "Инвентаризация и сверка истории",
        null,
        {
          "state": "verify",
          "finding": "Есть обработка фактически посчитанного остатка и ограничение исторических корректировок.",
          "next": "Проверить инвентаризацию, разницу, стоимость и дальнейшие движения.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/inventory/inventory.service.ts"
          }
        }
      ],
      [
        "inventory.supply",
        "Поставщики, закупки и складская стоимость",
        null,
        {
          "state": "verify",
          "finding": "Есть заказ, оплата, получение, возврат поставщику и возмещение.",
          "next": "Подтвердить полный цикл частичного прихода, оплаты и возврата поставщику.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/inventory/inventory.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "compensation",
    "Условия оплаты и вознаграждения",
    "Место в UI требует согласования",
    [
      [
        "compensation.rules",
        "Оклад, процент, сдельная и почасовая модели",
        null,
        {
          "state": "investigate",
          "finding": "Модели условий вознаграждения участника не найдены в проверенной схеме.",
          "next": "Определить оклад, процент, сдельную и почасовую оплату.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ],
      [
        "compensation.accrual",
        "Начисление по фактическому участию, корректировка и выплата",
        null,
        {
          "state": "investigate",
          "finding": "Связь фактического участия, начисления и выплаты не подтверждена.",
          "next": "После условий вознаграждения связать выполненную работу, начисление, долг и выплату.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ]
    ]
  ],
  [
    "obligations",
    "Финансовые обязательства",
    "Финансы (точное место требует согласования)",
    [
      [
        "obligations.record",
        "Обязательства по аренде, оплате труда, долгу и срокам",
        null,
        {
          "state": "finish",
          "finding": "Займы и инвестиции учитываются; обязательства по аренде и оплате труда отдельно не подтверждены.",
          "next": "Проверить существующий долг и дополнить недостающие обязательства со сроками.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/finance/finance.service.ts"
          }
        }
      ],
      [
        "obligations.settle",
        "Погашение, остаток, просрочка и история",
        null,
        {
          "state": "finish",
          "finding": "Операции возврата займа и инвестиций существуют.",
          "next": "Подтвердить остаток долга, частичное погашение, просрочку и историю для нужных видов обязательств.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/finance/finance.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "finance",
    "Финансовые операции",
    "Финансы → Касса / ДДС / Z-отчёт",
    [
      [
        "finance.prof",
        "Финансовый контур Professional",
        "start.finance",
        {
          "state": "verify",
          "finding": "Финансовая навигация и учёт операций существуют.",
          "next": "Проверить кошельки, ДДС, возврат, отмену, итог дня и остаток.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/finance/finance.js"
          }
        }
      ],
      [
        "finance.core",
        "Единый серверный учёт платежей, возвратов и движений без дублей",
        null,
        {
          "state": "verify",
          "finding": "Серверные расчёт, оплата, возврат и проводки существуют.",
          "next": "Подтвердить частичную оплату, возврат, отказ и повтор без двойного движения.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/finance/payment-settlement.service.ts"
          }
        }
      ],
      [
        "finance.reconcile",
        "Сверка операций и остатков с фактическими продажами и услугами",
        null,
        {
          "state": "verify",
          "finding": "Есть единый учёт финансовых операций и связь с источниками.",
          "next": "Сверить фактические деньги, задолженность, продажу, услугу и остаток кошельков.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/finance/finance.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "cost",
    "Себестоимость",
    "Склад / Сервис / Финансы (точное место требует согласования)",
    [
      [
        "cost.materials",
        "Фактический расход материалов и стоимость",
        null,
        {
          "state": "verify",
          "finding": "Реализован расчёт стоимости складских движений и расхода по записи.",
          "next": "Проверить фактический расход в граммах/мл/штуках и сохранённую себестоимость.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "core/inventory/stock-metrics.js"
          }
        }
      ],
      [
        "cost.time",
        "Стоимость времени участников и ресурсов",
        null,
        {
          "state": "investigate",
          "finding": "Отдельная стоимость времени исполнителя и ресурса не подтверждена.",
          "next": "Связать фактическое время с условиями оплаты и стоимостью использования ресурса.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/prisma/schema.prisma"
          }
        }
      ],
      [
        "cost.operation",
        "Себестоимость услуги и товара с сохранением исторического расчёта",
        null,
        {
          "state": "finish",
          "finding": "Материальная стоимость и цена продажи существуют; полный исторический расчёт затрат не подтверждён.",
          "next": "Объединить материалы, труд и ресурс без пересчёта закрытой операции.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/inventory/inventory.service.ts"
          }
        }
      ]
    ]
  ],
  [
    "configuration",
    "Конфигурация инструментов",
    "Меню / Настройки (точное место требует согласования)",
    [
      [
        "config.visibility",
        "Независимое включение/скрытие инструментов без потери данных",
        null,
        {
          "state": "finish",
          "finding": "Фильтрация доступности по правам существует; независимый пользовательский выбор видимости не подтверждён.",
          "next": "Проверить включение и скрытие рабочего процесса без потери данных и изменения тарифа.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "professional/workspace.js"
          }
        }
      ],
      [
        "config.retail",
        "Торговля без Журнала и настройка основного рабочего контура",
        null,
        {
          "state": "finish",
          "finding": "В меню есть Journal; отдельный рабочий контур торговли не подтверждён.",
          "next": "Завершить возможность работать только с продажами, без обязательного журнала.",
          "source": {
            "repo": "professional",
            "sha": "7c14154583f0108e7ec743e74d2877ae59278e7c",
            "path": "professional/workspace.js"
          }
        }
      ],
      [
        "config.entitlement",
        "Отдельные права тарифа и коммерческая готовность без подмены покрытия",
        null,
        {
          "state": "verify",
          "finding": "Права, режимы и готовность инструментов разделены и проверяются.",
          "next": "Подтвердить, что изменение видимости не меняет тарифные права и исторические данные.",
          "source": {
            "repo": "core",
            "sha": "b264f21a70b11354cdb0c7f6182b2642b88bebd8",
            "path": "server/src/saas-access/saas-access.service.ts"
          }
        }
      ]
    ]
  ]
];
const SHA = /^[a-f0-9]{40}$/;
const validSha = value => typeof value === 'string' && SHA.test(value);
const matches = (pattern, path) => typeof path === 'string' && (pattern.endsWith('/**') ? path.startsWith(pattern.slice(0,-3) + '/') : pattern === path);
export function closureEvidence(item, comparison, byId) {
  const closure = item?.closure;
  if (!closure || closure.state !== 'locked') return { accepted: false, state: closure?.state === 'verifying' ? 'checking' : 'unknown' };
  const required = [...(item.requires || []), ...[...byId.values()].filter(row=>row.parent===item.id).map(row=>row.id)];
  if (!validSha(closure.baselineSha) || !closure.approvedBy || !closure.approvedAt ||
      !Array.isArray(closure.evidence) || !closure.evidence.length ||
      !Object.keys(item.acceptance || {}).length || Object.values(item.acceptance).some(v=>!v || v==='не проверено') ||
      !Array.isArray(item.paths) || !item.paths.length || required.some(id=>byId.get(id)?.closure?.state!=='locked')) {
    return { accepted: false, state: 'unknown' };
  }
  // Accepted history is independent from a new candidate. No diff is not a pass.
  const base = { accepted: true, baselineSha: closure.baselineSha, approvedAt: closure.approvedAt, evidence: closure.evidence };
  if (required.length || item.external?.length) return {...base,state:'unverified'};
  if (!comparison || !['ahead','identical'].includes(comparison.status) || !Array.isArray(comparison.files) || comparison.files.length>=300) return {...base,state:'unverified'};
  const changed = comparison.files.filter(f=>item.paths.some(p=>matches(p,f.filename)||matches(p,f.previous_filename)));
  return {...base,state:changed.length?'changed':'accepted',changed:changed.map(f=>f.filename)};
}
export function coverageSnapshot(registry, comparisons = {}) {
  if (!Array.isArray(registry?.items) || registry.schemaVersion !== 1 ||
      registry.repository !== 'co-va/professional' || registry.branch !== 'staging') throw Error('Неизвестный формат реестра Professional');
  const byId = new Map(registry.items.map(item=>[item.id,item]));
  if (byId.size !== registry.items.length) throw Error('Дубли ID в реестре Professional');
  const unique = new Map();
  const summarize = rows => {
    const confirmed = rows.filter(row=>row.accepted).length;
    return {confirmed,total:rows.length,percent:rows.length?Math.floor(100*confirmed/rows.length):null,
      changed:rows.filter(row=>row.state==='changed').length,
      unverified:rows.filter(row=>row.state==='unverified').length,
      currentConfirmed:rows.filter(row=>row.state==='accepted').length};
  };
  const mechanisms = MECHANISMS.map(([id,label,location,criteria])=>{
    const rows=criteria.map(([key,title,ref,work])=>{
      if (!unique.has(key)) {
        const item=byId.get(ref);
        unique.set(key,{key,title,ref,work,...closureEvidence(item,comparisons[item?.closure?.baselineSha],byId)});
      }
      return unique.get(key);
    });
    return {id,label,location,rows,...summarize(rows)};
  });
  return {mechanisms,...summarize([...unique.values()])};
}
const API = 'https://api.github.com/repos/co-va/professional';
const RAW = 'https://raw.githubusercontent.com/co-va/professional';
async function readJson(url, fetcher) {
  const response=await fetcher(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Источник недоступен ('+response.status+')');
  return response.json();
}
export async function loadOperationalReadiness(fetcher=fetch) {
  const head=await readJson(API+'/git/ref/heads/staging',fetcher);
  const sha=head?.object?.sha;
  if(!validSha(sha)) throw Error('Версия Professional не определена');
  const registry=await readJson(RAW+'/'+sha+'/RELEASE_CLOSURE_REGISTRY.json',fetcher);
  if(!Array.isArray(registry?.items)) throw Error('Реестр Professional не получен');
  const refs=new Set(MECHANISMS.flatMap(m=>m[3].map(c=>c[2]).filter(Boolean)));
  const bases=[...new Set(registry.items.filter(i=>refs.has(i.id)&&i.closure?.state==='locked'&&validSha(i.closure.baselineSha)).map(i=>i.closure.baselineSha))];
  const comparisons=Object.fromEntries(await Promise.all(bases.map(async base=>{
    if(base===sha) return [base,{status:'identical',files:[]}];
    try {return [base,await readJson(API+'/compare/'+base+'...'+sha,fetcher)];}
    catch {return [base,null];}
  })));
  const coverage=coverageSnapshot(registry,comparisons);
  return {sha,...coverage,professionalAudit:professionalAuditSnapshot(registry,sha,coverage)};
}

/* #942: exact, narrowly scoped evidence from existing Core CI; never equate a
 * successful sub-scenario with full operational criterion or owner acceptance. */
export const CORE_SCENARIOS = [
  {
    "id": "workspace.capacity",
    "criteria": [
      "workspace.profile",
      "workspace.multiple"
    ],
    "title": "Лимиты пространств DEMO/LIVE, скрытие и добавление",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/demo-workplace-capacity.test.mjs"
  },
  {
    "id": "workspace.booking",
    "criteria": [
      "workspace.multiple",
      "records.core"
    ],
    "title": "Адресная онлайн-запись и изоляция пространств",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/booking-direct-workplace-link.test.mjs"
  },
  {
    "id": "access.history",
    "criteria": [
      "permissions.enforcement",
      "contacts.core"
    ],
    "title": "Проверка доступа к истории по действующему участию",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/history-authorization.test.mjs"
  },
  {
    "id": "access.readiness",
    "criteria": [
      "config.entitlement",
      "permissions.enforcement"
    ],
    "title": "Раздельные права тарифа, режимы и готовность инструментов",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/admin-readiness-policy.test.mjs"
  },
  {
    "id": "contacts.reimport",
    "criteria": [
      "contacts.core",
      "contacts.prof"
    ],
    "title": "Импорт контактов: повторы, различия, UEI, Email и сохранение данных",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "service.history",
    "criteria": [
      "services.core"
    ],
    "title": "Исторические цены услуг и сохранение снимков записи",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "service.public",
    "criteria": [
      "services.core",
      "workspace.multiple"
    ],
    "title": "Условия услуги по пространствам, длительность, публичная видимость",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/procedure-booking-contract.test.mjs"
  },
  {
    "id": "record.server",
    "criteria": [
      "records.core"
    ],
    "title": "Серверный контракт записи, доступности и расчёта",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/booking-server-autonomy.test.mjs"
  },
  {
    "id": "record.delete",
    "criteria": [
      "records.core"
    ],
    "title": "История удаления записи с исходными данными и автором",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/record-deletion-audit.test.mjs"
  },
  {
    "id": "record.import",
    "criteria": [
      "records.core"
    ],
    "title": "Импорт записей: несколько услуг, история, повтор без дублей",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "inventory.units",
    "criteria": [
      "inventory.stock",
      "products.price"
    ],
    "title": "Единицы расхода и продажи целой упаковки",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/inventory-package-units.test.mjs"
  },
  {
    "id": "inventory.resource",
    "criteria": [
      "inventory.stock",
      "cost.materials"
    ],
    "title": "Контракт складской карточки, конверсия единиц и перемещение",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/inventory-universal-card.test.mjs"
  },
  {
    "id": "inventory.order",
    "criteria": [
      "inventory.stock"
    ],
    "title": "Порядок позиций склада и ограничения PostgreSQL",
    "job": "staging-smoke",
    "step": "Verify inventory rank invariants with real PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-inventory-positions.mjs"
  },
  {
    "id": "inventory.supplier",
    "criteria": [
      "inventory.supply",
      "products.price"
    ],
    "title": "Импорт прайса поставщика, обновление цен и изоляция",
    "job": "check",
    "step": "Verify supplier pricelist import runtime",
    "command": "node tests/inventory-counterparty-runtime.test.mjs"
  },
  {
    "id": "finance.import",
    "criteria": [
      "finance.core",
      "finance.reconcile"
    ],
    "title": "Импорт ДДС: кошельки, возврат, отмена и повтор без дублей",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "finance.record",
    "criteria": [
      "finance.core",
      "finance.reconcile",
      "services.execution"
    ],
    "title": "Историческая оплата, связь платежа с записью и единственный расчёт",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "finance.deposit",
    "criteria": [
      "finance.core",
      "finance.reconcile"
    ],
    "title": "Депозит: внесение, списание, срок действия, коррекция и повторный импорт",
    "job": "staging-smoke",
    "step": "Verify canonical Deposit Excel import with real PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-deposit-excel.mjs"
  },
  {
    "id": "materials.link",
    "criteria": [
      "cost.materials",
      "inventory.stock"
    ],
    "title": "Привязка исторического расхода к записи и услуге",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "history.isolation",
    "criteria": [
      "permissions.enforcement",
      "contacts.core"
    ],
    "title": "Изоляция истории, атомарное удаление и откат",
    "job": "staging-smoke",
    "step": "Verify owner-scoped History with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-history.mjs"
  }
];
const CORE_API = 'https://api.github.com/repos/co-va/core';
const CORE_RAW = 'https://raw.githubusercontent.com/co-va/core';
export function coreAuditSnapshot(sha, run, jobs, pkg, workflow) {
  if (!validSha(sha) || run?.head_sha !== sha || run.path !== '.github/workflows/check.yml'
      || !Array.isArray(jobs) || typeof workflow !== 'string') throw Error('Нет доказательств для данной версии Core');
  const lines=workflow.split(/\r?\n/);
  const tests=new Set(String(pkg?.scripts?.test||'').split(' && ').map(s=>s.trim()));
  const scenarios=CORE_SCENARIOS.map(s=>{
    const workflowMatches=lines.some((line,i)=>line.trim()==='- name: '+s.step && lines[i+1]?.trim()==='run: '+s.command);
    const registered=workflowMatches && (!s.test || tests.has('node '+s.test));
    const job=jobs.filter(j=>j.name===s.job && j.head_sha===sha).sort((a,b)=>b.id-a.id)[0];
    const step=job?.steps?.find(x=>x.name===s.step);
    const state=!registered?'unknown':step?.conclusion==='failure'?'failed':
      job?.conclusion==='success' && step?.conclusion==='success'?'passed':'unknown';
    return {...s,state,url:job?.html_url || 'https://github.com/co-va/core/actions/runs/'+run.id};
  });
  return {sha,runId:run.id,scenarios,passed:scenarios.filter(s=>s.state==='passed').length,total:scenarios.length,
    failed:scenarios.filter(s=>s.state==='failed').length};
}
async function readCoreText(url, fetcher) {
  const response=await fetcher(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Источник недоступен ('+response.status+')');
  return response.text();
}
export async function loadCoreAudit(fetcher=fetch) {
  const head=await readJson(CORE_API+'/git/ref/heads/main',fetcher);
  const sha=head?.object?.sha;
  if(!validSha(sha)) throw Error('Версия Core не определена');
  const checks=await readJson(CORE_API+'/commits/'+sha+'/check-runs?per_page=100',fetcher);
  const check=(checks.check_runs||[]).filter(c=>c.name==='check' && c.head_sha===sha && c.app?.slug==='github-actions')
    .sort((a,b)=>b.id-a.id)[0];
  const match=/^https:\/\/github\.com\/co-va\/core\/actions\/runs\/(\d+)\/job\/\d+$/.exec(check?.details_url||'');
  if(!match) throw Error('Проверки Core не найдены');
  const base=CORE_API+'/actions/runs/'+match[1];
  const [run,jobs,pkg,workflow]=await Promise.all([
    readJson(base,fetcher),readJson(base+'/jobs?per_page=100',fetcher),
    readJson(CORE_RAW+'/'+sha+'/package.json',fetcher),readCoreText(CORE_RAW+'/'+sha+'/.github/workflows/check.yml',fetcher)
  ]);
  return coreAuditSnapshot(sha,run,jobs.jobs,pkg,workflow);
}

/* Existing User CI and Professional acceptance records. No new workflow,
 * no second closure registry, no promotion of historical evidence to current PASS. */
export const USER_SCENARIOS = [
  {
    "id": "user.record.contract",
    "criteria": [
      "records.user"
    ],
    "title": "User: единый Account API и последовательность шагов записи",
    "step": "Record contract",
    "script": "scripts/ci/guard-record.mjs"
  },
  {
    "id": "user.record.journal",
    "criteria": [
      "records.user"
    ],
    "title": "User: браузерный сценарий Журнала, мини-карта, повтор записи и сброс уведомлений (fixture)",
    "step": "Local UI browser smoke",
    "script": "scripts/ci/user-journal-record-smoke.mjs"
  },
  {
    "id": "user.account.isolation",
    "criteria": [
      "permissions.enforcement"
    ],
    "title": "User: изоляция состояния при смене аккаунта, события и заметки",
    "step": "Account-scoped state and duplicate-load contract",
    "script": "scripts/ci/user-account-session-smoke.mjs"
  },
  {
    "id": "user.profile.contract",
    "criteria": [
      "contacts.core"
    ],
    "title": "User: единый редактор персональных данных и маршрут сохранения Account",
    "step": "Profile contract",
    "script": "scripts/ci/guard-profile.mjs"
  }
];
const PROF_SCENARIOS = [
  {
    "id": "prof.journal.owner",
    "criteria": [
      "records.prof"
    ],
    "ref": "start.journal",
    "title": "Professional: ранее принятая владельцем функциональность Журнала; отдельный E2E не подтверждён"
  },
  {
    "id": "prof.schedule",
    "criteria": [
      "time.schedule"
    ],
    "ref": "journal.graph",
    "title": "Professional: ранее выполненные изолированные сценарии графика"
  },
  {
    "id": "prof.payment",
    "criteria": [
      "finance.prof",
      "services.execution"
    ],
    "ref": "journal.payment",
    "title": "Professional: ранее выполненные изолированные сценарии оплаты и возврата"
  },
  {
    "id": "prof.record.model",
    "criteria": [
      "records.prof"
    ],
    "ref": "start.journal",
    "title": "Professional: ранее выполненные модельные проверки Журнала"
  },
  {
    "id": "prof.service.acceptance",
    "criteria": [
      "catalog.prof"
    ],
    "ref": "start.service",
    "title": "Professional: принятый каталог услуг и товаров"
  }
];
const USER_API='https://api.github.com/repos/co-va/user';
const USER_RAW='https://raw.githubusercontent.com/co-va/user';
export function userAuditSnapshot(sha,run,jobs,workflow) {
  if(!validSha(sha)||run?.head_sha!==sha||run.path!=='.github/workflows/check.yml'||
    !Array.isArray(jobs)||typeof workflow!=='string') throw Error('Нет доказательств для данной версии User');
  const lines=workflow.split(/\r?\n/);
  const job=jobs.filter(j=>j.name==='check'&&j.head_sha===sha).sort((a,b)=>b.id-a.id)[0];
  const scenarios=USER_SCENARIOS.map(s=>{
    const start=lines.findIndex(l=>l.trim()==='- name: '+s.step);
    const end=lines.findIndex((l,i)=>i>start&&/^\s*- (name:|uses:)/.test(l));
    const block=start<0?[]:lines.slice(start,end<0?undefined:end);
    const registered=block.some(l=>['run: node '+s.script,'node '+s.script].includes(l.trim()));
    const step=job?.steps?.find(x=>x.name===s.step);
    return {...s,state:!registered?'unknown':step?.conclusion==='failure'?'failed':
      job?.conclusion==='success'&&step?.conclusion==='success'?'passed':'unknown',
      url:'https://github.com/co-va/user/actions/runs/'+Number(run.id)+(job?'/job/'+Number(job.id):'')};
  });
  return {sha,runId:run.id,scenarios,passed:scenarios.filter(s=>s.state==='passed').length,total:scenarios.length,
    failed:scenarios.filter(s=>s.state==='failed').length};
}
export async function loadUserAudit(fetcher=fetch) {
  const head=await readJson(USER_API+'/git/ref/heads/main',fetcher);
  const sha=head?.object?.sha;
  if(!validSha(sha)) throw Error('Версия User не определена');
  const runs=await readJson(USER_API+'/actions/runs?head_sha='+sha+'&per_page=100',fetcher);
  const run=(runs.workflow_runs||[]).filter(r=>r.head_sha===sha&&r.path==='.github/workflows/check.yml')
    .sort((a,b)=>b.id-a.id)[0];
  if(!run) throw Error('Проверки User не найдены');
  const [jobs,workflow]=await Promise.all([
    readJson(USER_API+'/actions/runs/'+Number(run.id)+'/jobs?per_page=100',fetcher),
    readCoreText(USER_RAW+'/'+sha+'/.github/workflows/check.yml',fetcher)
  ]);
  return userAuditSnapshot(sha,run,jobs.jobs,workflow);
}
export function professionalAuditSnapshot(registry,sha,coverage) {
  if(!validSha(sha)||registry?.repository!=='co-va/professional'||registry.branch!=='staging'||
    !Array.isArray(registry.items)) throw Error('Нет реестра Professional');
  const items=new Map(registry.items.map(i=>[i.id,i]));
  const current=new Map(coverage.mechanisms.flatMap(m=>m.rows).map(c=>[c.key,c]));
  const scenarios=PROF_SCENARIOS.map(s=>{
    const item=items.get(s.ref);
    const evidence=item?.closure?.evidence;
    const recorded=Array.isArray(evidence)&&evidence.some(v=>typeof v==='string'&&v.trim());
    const accepted=s.criteria.every(k=>current.get(k)?.state==='accepted');
    return {...s,state:!recorded?'unknown':accepted?'passed':'historical',
      url:'https://github.com/co-va/professional/blob/'+sha+'/RELEASE_CLOSURE_REGISTRY.json'};
  });
  return {sha,scenarios,total:scenarios.length,passed:scenarios.filter(s=>s.state==='passed').length,
    historical:scenarios.filter(s=>s.state==='historical').length,failed:0};
}
export function evidenceCoverage(snapshot,...audits) {
  const keys=new Set(MECHANISMS.flatMap(m=>m[3].map(c=>c[0])));
  const supported=new Set((snapshot?.mechanisms||[]).flatMap(m=>m.rows.filter(c=>c.accepted).map(c=>c.key)));
  for(const audit of audits) for(const s of audit?.scenarios||[]) {
    if(s.state==='passed'||s.state==='historical') for(const key of s.criteria) if(keys.has(key)) supported.add(key);
  }
  return {supported:supported.size,total:keys.size,unknown:keys.size-supported.size};
}
const auditStateLabel={passed:'PASS',failed:'FAIL',historical:'Ранее проверено · актуальность требует сверки',unknown:'Не подтверждено'};

const auditFor = (audit,keys) => (audit?.scenarios||[]).filter(s=>s.criteria.some(k=>keys.includes(k)));
const workLabels={closed:'Закрыто',recheck:'Перепроверить',verify:'Проверить',finish:'Доработать',investigate:'Уточнить реализацию'};
export function workState(criterion,checks=[]) {
  if (checks.some(s=>s.state==='failed')) return 'finish';
  if (criterion.state==='accepted') return 'closed';
  if (criterion.accepted) return 'recheck';
  return criterion.work?.state || 'investigate';
}
export function workQueue(snapshot,audits={scenarios:[]}) {
  const mechanisms=snapshot?.mechanisms||MECHANISMS.map(([id,label,location,criteria])=>({id,label,location,rows:criteria.map(([key,title,ref,work])=>({key,title,ref,work,state:'unknown'})),percent:null}));
  const rows=mechanisms.map(m=>({...m,rows:m.rows.map(c=>({...c,workState:workState(c,auditFor(audits,[c.key]))}))}));
  const unique=new Map(rows.flatMap(m=>m.rows.map(c=>[c.key,c])));
  const counts={closed:0,recheck:0,verify:0,finish:0,investigate:0};
  for(const c of unique.values()) counts[c.workState]++;
  return {rows,counts,total:unique.size};
}

const stateLabel = {accepted:'Принято',changed:'Изменено · нужна проверка',unverified:'Актуальность не подтверждена',checking:'В проверке',unknown:'Не подтверждено'};
export function readinessMarkup(snapshot, escapeHtml, selected='', coreAudit=null, userAudit=null) {
  const e=escapeHtml;
  const profAudit=snapshot?.professionalAudit;
  const evidence=evidenceCoverage(snapshot,coreAudit,userAudit,profAudit);
  const allAudits={scenarios:[...(coreAudit?.scenarios||[]),...(userAudit?.scenarios||[]),...(profAudit?.scenarios||[])]};
  const evidenceSummary='<div class="admin-overview-chart-summary"><strong>'+evidence.supported+' / '+evidence.total+'</strong><span>Критерии с доказательствами выполнения или частичной проверки</span></div><p class="admin-overview-empty">Остальные '+evidence.unknown+' требуют аудита. Это охват доказательствами, не процент завершённости продукта.</p>';
  const userSummary=userAudit?'<p class="admin-overview-empty">User/main: '+userAudit.passed+' / '+userAudit.total+' автопроверок · '+e(userAudit.sha.slice(0,12))+' · <a href="https://github.com/co-va/user/actions/runs/'+Number(userAudit.runId)+'" target="_blank" rel="noopener noreferrer">Результаты CI</a></p>':'<p class="admin-overview-empty">User: данные автопроверок не получены.</p>';
  const profSummary=profAudit?'<p class="admin-overview-empty">Professional/staging: '+profAudit.passed+' принято, '+profAudit.historical+' ранее проверенных сценария. Автоматического CI Professional пока нет; прежние доказательства не считаются проверкой новой версии.</p>':'<p class="admin-overview-empty">Professional: реестр не получен.</p>';
  const coreSummary=coreAudit ? '<div class="admin-overview-chart-summary"><strong>'+coreAudit.passed+' / '+coreAudit.total+'</strong><span>Подключённые сценарии Core: автоматические проверки пройдены</span></div><p class="admin-overview-empty">Core/main: '+e(coreAudit.sha.slice(0,12))+' · ошибок проверки: '+coreAudit.failed+' · <a href="https://github.com/co-va/core/actions/runs/'+Number(coreAudit.runId)+'" target="_blank" rel="noopener noreferrer">Результаты CI</a>. Это проверенные части критериев, не готовность всей платформы.</p>' : '<p class="admin-overview-empty">Автопроверки Core: данные не получены.</p>';
  const summary=snapshot ? '<div class="admin-overview-chart-summary"><strong>'+snapshot.confirmed+' / '+snapshot.total+'</strong><span>Полная приёмка критериев ('+snapshot.percent+'%)</span></div><p class="admin-overview-empty">Professional/staging: '+e(snapshot.sha.slice(0,12))+' · актуальность подтверждена: '+snapshot.currentConfirmed+' · изменено: '+snapshot.changed+' · актуальность не проверена: '+snapshot.unverified+'. Не является процентом готовности действующего релиза.</p>' : '<p class="admin-overview-empty">Данные технического реестра недоступны. Проценты не определены.</p>';
  const queue=workQueue(snapshot,allAudits);
  const mainSummary='<div class="admin-overview-chart-summary"><strong>'+queue.counts.closed+' / '+queue.total+'</strong><span>Закрытые вопросы</span></div><p class="admin-overview-empty">Проверить: '+(queue.counts.verify+queue.counts.recheck)+' · Доработать: '+queue.counts.finish+' · Уточнить реализацию: '+queue.counts.investigate+'.</p><p class="admin-overview-empty">Анализ исходников от 24.11.2026. Выбери направление, внутри — что уже есть и какое действие осталось. Отсутствие доказательства не означает отсутствие функции.</p>';
  const rows=queue.rows.map((m,i)=>{
    const open=selected===m.id;
    const closed=m.rows.filter(c=>c.workState==='closed').length;
    const pending=m.rows.filter(c=>c.workState!=='closed');
    const next=pending.find(c=>c.workState==='finish')||pending.find(c=>c.workState==='investigate')||pending[0];
    const checked=closed===m.rows.length?'Закрыто':workLabels[next.workState];
    return '<button type="button" class="admin-overview-person" data-operational-mechanism="'+e(m.id)+'" aria-expanded="'+open+'"><span><strong>'+String(i+1).padStart(2,'0')+' · '+e(m.label)+'</strong></span><span class="admin-overview-person-status">'+closed+'/'+m.rows.length+' · '+e(checked)+' '+(open?'−':'+')+'</span></button>'+
      (open?'<div class="admin-overview-detail"><div class="admin-overview-detail-heading"><strong>'+e(m.label)+'</strong></div><div class="admin-overview-detail-list">'+m.rows.map(c=>'<div class="admin-overview-person"><span><strong>'+e(c.title)+'</strong><small>'+e(workLabels[c.workState])+'</small><small>Что есть: '+e(c.work.finding)+'</small><small>Следующее действие: '+e(c.workState==='closed'?'Вопрос закрыт. Не возвращаться без конкретной регрессии.':c.work.next)+'</small><small><a href="https://github.com/co-va/'+e(c.work.source.repo)+'/blob/'+e(c.work.source.sha)+'/'+e(c.work.source.path)+'" target="_blank" rel="noopener noreferrer">Исходник аудита</a> · '+e(stateLabel[c.state])+(c.baselineSha?' · '+e(c.baselineSha.slice(0,12)):'')+'</small>'+(c.ref?'<small><a href="https://github.com/co-va/professional/blob/'+(snapshot?.sha||'staging')+'/RELEASE_CLOSURE_REGISTRY.json" target="_blank" rel="noopener noreferrer">'+e(c.ref)+'</a></small>':'')+(c.approvedAt?'<small>Приёмка: '+e(c.approvedAt)+'</small>':'')+(c.changed?.length?'<small>'+e(c.changed.join(', '))+'</small>':'')+auditFor(allAudits,[c.key]).map(s=>'<small><a href="'+e(s.url)+'" target="_blank" rel="noopener noreferrer">'+e(s.title)+'</a> · '+e(auditStateLabel[s.state])+'</small>').join('')+'</span></div>').join('')+'</div></div>':'');
  }).join('');
  return '<div class="admin-overview"><div class="admin-heading"><h2>Операционная готовность</h2></div><section class="admin-overview-panel"><div class="admin-overview-panel-head"><h3>Услуги и продажи</h3><div class="admin-overview-period"><button type="button" data-operational-back>Обзор</button><button type="button" data-operational-refresh>Обновить</button></div></div>'+mainSummary+'<div class="admin-overview-detail-list">'+rows+'</div><button type="button" class="admin-overview-person" data-operational-mechanism="__evidence" aria-expanded="'+(selected==='__evidence')+'"><span><strong>Доказательства и версии</strong></span><span class="admin-overview-person-status">'+(selected==='__evidence'?'−':'+')+'</span></button><div '+(selected==='__evidence'?'':'hidden')+'>'+evidenceSummary+coreSummary+userSummary+profSummary+summary+'</div></section></div>';
}
export function renderOperationalReadiness(content, {escapeHtml,isCurrent,onBack,load=loadOperationalReadiness,loadCore=loadCoreAudit,loadUser=loadUserAudit}) {
  if (!content) return;
  let selected='', snapshot=null, coreAudit=null, userAudit=null, request=0;
  const render=()=>{
    if(!isCurrent()) return;
    content.innerHTML=readinessMarkup(snapshot,escapeHtml,selected,coreAudit,userAudit);
    content.querySelector('[data-operational-refresh]')?.addEventListener('click',refresh);
    content.querySelector('[data-operational-back]')?.addEventListener('click',()=>onBack?.());
    content.querySelectorAll('[data-operational-mechanism]').forEach(button=>button.addEventListener('click',()=>{
      selected=selected===button.dataset.operationalMechanism?'':button.dataset.operationalMechanism;
      render();
    }));
  };
  async function refresh(){
    const id=++request;
    snapshot=null; coreAudit=null; userAudit=null; render();
    const control=content.querySelector('[data-operational-refresh]');
    if(control) {control.disabled=true;control.textContent='Загрузка…';}
    const [professional,core,user]=await Promise.allSettled([load(),loadCore(),loadUser()]);
    if(id===request&&isCurrent()) {
      if(professional.status==='fulfilled') snapshot=professional.value;
      if(core.status==='fulfilled') coreAudit=core.value;
      if(user.status==='fulfilled') userAudit=user.value;
    }
    if(id===request&&isCurrent()) render();
  }
  render(); void refresh();
}
