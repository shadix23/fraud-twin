"""Тексты симулятора на двух языках: ru (исходный) и en.

Симулятор собирает фразы из шаблонов и чисел на русском. Перевод делается на выходе:
`translate(payload, lang)` обходит готовый JSON-ответ и переводит каждую строку по таблицам
ниже. Числа, ключи, порядок и seed не затрагиваются, поэтому ru и en совпадают по цифрам,
а детерминизм поиска сохраняется. Логика кода (сравнение префиксов подсказок и т.п.)
работает с русским оригиналом до перевода.

Устройство:
- EXACT: строка целиком -> английский.
- RULES: шаблоны с числами. В русской части `{a}` - число, `[день|дня|дней]` - любая форма,
  `{u}` - единица (мин, ч), `{x}` - любой кусок без перевода (дата, ссылка), `{t}` - кусок,
  который переводится рекурсивно. В английской `{a}` - число в английском формате,
  `{a?day|days}` - форма по числу, `{u}` - единица, `{x}`, `{t}`.
- Составные строки («Возраст карты отправителя: 5 дней. За сутки прислали ...») режутся на
  предложения, каждое переводится отдельно.
Непереведённая строка остаётся как есть и попадает в `MISSED` (тесты проверяют, что он пуст).

Новый язык: добавить таблицы по образцу EN и записать код в LANGS.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

LANGS = ("ru", "en")
DEFAULT_LANG = "ru"

MISSED: set = set()
_CYR = re.compile("[а-яА-ЯёЁ]")


def norm_lang(lang) -> str:
    """Неизвестный или пустой язык = ru."""
    return lang if lang in LANGS else DEFAULT_LANG


# ------------------------------------------------------------------ точные строки
EXACT: Dict[str, str] = {
    # профили банка
    "Демо-банк": "Demo bank",
    "Цифровой банк": "Digital bank",
    "Региональный банк": "Regional bank",
    "Ваш банк (калибровка)": "Your bank (calibrated)",
    "условный универсальный банк": "a generic all-purpose bank",
    # поля калибровки
    "Клиентов в двойнике": "Customers in the twin",
    "Доля студентов": "Share of students",
    "Доля пенсионеров": "Share of pensioners",
    "Лимит одного перевода": "Single transfer limit",
    "Суточный лимит исходящих": "Daily outgoing limit",
    "Задержка заморозки после сигнала": "Freeze delay after an alert",
    # правила
    "Много переводов за час": "Many transfers in an hour",
    "Новый получатель и крупная сумма": "New recipient, large amount",
    "Молодой счёт получает крупную сумму": "Young account receives a large amount",
    "Один телефон у нескольких клиентов": "One phone shared by several customers",
    "Модель на графе переводов": "Transfer-graph model",
    "Задержка первого перевода новому получателю (сценарий)": "Hold on the first transfer to a new recipient (scenario)",
    "Задержка первого перевода новому получателю": "Hold on the first transfer to a new recipient",
    "Текущие правила банка": "Current bank rules",
    "Модель и задержка вместе": "Model and hold together",
    "дней": "days", "мин": "min", "ч": "h", "шт/ч": "per hour", "клиентов": "customers",
    "порог": "threshold",
    # схемы
    "Студенческие карты, вывод в крипту": "Student cards, cash-out to crypto",
    "Звонок «службы безопасности», веер дропов": "\"Security service\" call, drop fan-out",
    "Дробление под лимит": "Structuring under the limit",
    "Фейковый продавец, много мелких жертв": "Fake seller, many small victims",
    "Карусель через сеть онлайн-казино": "Carousel through an online casino network",
    "студенческие карты, вывод в крипту": "student cards, cash-out to crypto",
    "звонок «службы безопасности», веер дропов": "\"security service\" call, drop fan-out",
    "дробление под лимит": "structuring under the limit",
    "фейковый продавец, много мелких жертв": "fake seller, many small victims",
    "карусель через сеть онлайн-казино": "carousel through an online casino network",
    "Типология; суточные лимиты банков РК публично не найдены, лимит - параметр":
        "Typology; daily limits of Kazakhstan banks are not public, the limit is a parameter",
    # узлы и сегменты
    "Банкомат": "ATM", "Другой банк": "Another bank",
    "студент": "student", "наёмный": "employee", "пенсионер": "pensioner", "ИП": "sole proprietor",
    "мерчант": "merchant", "крипто-трейдер P2P": "P2P crypto trader", "дроп": "drop",
    # параметры схем (подписи полей дыры)
    "жертва платит частями": "victim pays in parts", "слоёв дропов": "drop layers",
    "ветвление": "branching", "пауза дропа, мин": "drop pause, min",
    "части дропа до": "drop parts up to", "между частями, мин": "gap between parts, min",
    "возраст карты, дней": "card age, days", "карт на телефон": "cards per phone",
    "вывод": "cash-out",
    "крипто-обменник": "crypto exchanger", "банкомат": "ATM", "карта другого банка": "another bank's card",
    "крипта и банкомат": "crypto and ATM", "банкомат и другой банк": "ATM and another bank",
    # модель
    "эвристика": "heuristic", "бустинг": "boosting",
    "бустинг на графовых признаках": "boosting on graph features",
    "сумма перевода": "transfer amount", "новый получатель": "new recipient",
    "возраст счёта": "account age", "клиентов на одном телефоне": "customers on one phone",
    "пришло за 24 ч": "received in 24 h", "ушло за 24 ч": "sent in 24 h",
    "ушло / пришло": "sent / received", "сколько деньги пролежали": "how long the money stayed",
    "входящих за 24 ч": "incoming in 24 h", "разных отправителей": "distinct senders",
    "незнакомых отправителей": "unfamiliar senders", "исходящих за 24 ч": "outgoing in 24 h",
    "транзитность отправителей (2-й шаг графа)": "pass-through rate of senders (2nd graph hop)",
    "час": "hour", "канал": "channel", "транзитность счёта": "account pass-through rate",
    "модель": "model",
    "GNN (GraphSAGE) не обучали: в этой сборке только CPU Mac, отложено в «что дальше».":
        "GNN (GraphSAGE) was not trained: this build runs on a Mac CPU only, left for \"what next\".",
    "LightGBM заменён гистограммным бустингом scikit-learn (тот же класс алгоритмов).":
        "LightGBM is replaced by scikit-learn histogram boosting (the same class of algorithm).",
    "Всё на синтетике: это проверка обобщения на новую схему, а не качество на данных банка.":
        "Everything runs on synthetic data: this tests generalization to a new scheme, not quality on real bank data.",
    "Модель обучена только на синтетике; честная проверка - на схеме, которой модель не видела при обучении (model/benchmark.json).":
        "The model is trained on synthetic data only; the honest test is a scheme the model did not see in training (model/benchmark.json).",
    # оговорки отчёта
    "Цифровой двойник: клиенты и переводы смоделированы, реальных данных нет.":
        "Digital twin: customers and transfers are simulated, there is no real data.",
    "Параметры двойника и пороги правил - гипотезы. Суточные лимиты банков РК публично не найдены, они заданы калибровкой.":
        "The twin's parameters and rule thresholds are hypotheses. Daily limits of Kazakhstan banks are not public, so calibration sets them.",
    "Суммы - за одни сутки атаки в двойнике, это не прогноз потерь реального банка.":
        "Amounts cover one day of an attack in the twin; they are not a loss forecast for a real bank.",
    "Задержка первого перевода новому получателю в РК для переводов не действует, это сценарий для обсуждения.":
        "A hold on the first transfer to a new recipient does not apply to transfers in Kazakhstan; it is a scenario for discussion.",
    # рекомендации и подсказки
    "Повторять краш-тест после каждого изменения": "Rerun the crash test after every change",
    "Повторный поиск ИИ-мошенника против модели обхода не нашёл. Повторять краш-тест при каждом изменении правил и появлении новой схемы.":
        "A repeated AI-fraudster search against the model found no bypass. Rerun the crash test whenever the rules change or a new scheme appears.",
    "Поправка правила": "Rule fix",
    "Считать сумму новому получателю за 24 часа": "Sum amounts to a new recipient over 24 hours",
    "Не доверять возрасту карты": "Do not trust card age",
    "Связи по телефону искать по графу": "Find phone links through the graph",
    "Замораживать быстрее, чем жертва заметит": "Freeze faster than the victim notices",
    "Нужна реакция в реальном времени": "Real-time reaction is needed",
    "Отдельные переводы выглядят обычными": "Single transfers look ordinary",
    "Ни одно правило не сработало: каждый перевод по отдельности выглядит обычным.":
        "No rule fired: every single transfer looks ordinary.",
    # причины риска в ленте
    "Деньги пришли с транзитных карт": "The money came from pass-through cards",
    "Получатель новый для отправителя": "The recipient is new to the sender",
    "Карта получателя уже заморожена банком": "The recipient's card is already frozen by the bank",
    "У карты получателя нет движения за сутки: модели нечего оценить":
        "The recipient's card had no activity in the last 24 hours: nothing for the model to score",
    "Сумма выше лимита одного перевода": "Amount above the single transfer limit",
    "Превышен суточный лимит исходящих": "Daily outgoing limit exceeded",
    # экран клиента
    "Синтетика, оценка: цифры из двойника банка, не из данных BCC.":
        "Synthetic estimate: figures come from the bank twin, not from BCC data.",
    "Похоже на карту дроппера": "This looks like a drop card",
    "Мы приостановили перевод, деньги пока у вас. Вот что нас насторожило:":
        "We paused the transfer and your money is still with you. Here is what worried us:",
    "Вам звонили и просили срочно перевести деньги? Сотрудники банка и полиции так не делают.":
        "Did someone call and ask you to send money urgently? Bank and police staff never do that.",
    "Банк вправе приостановить перевод и обязан назвать причину (Закон РК о платежах, ст. 25-1, сверить).":
        "A bank may pause a transfer and must state the reason (Kazakhstan payments law, art. 25-1, to be verified).",
    "Проверьте получателя": "Check the recipient",
    "Перевод ещё не отправлен. С этой картой есть странности:":
        "The transfer has not been sent yet. Something is odd about this card:",
    "Вы знаете этого человека лично? Если вас торопят по телефону, лучше отменить.":
        "Do you know this person? If someone is rushing you on the phone, it is better to cancel.",
    "Перевод отправлен": "Transfer sent",
    "Получатель проверен, ничего подозрительного.": "The recipient was checked, nothing suspicious.",
    "Перевод не выполнен": "Transfer not completed",
    "Операции по карте получателя приостановлены банком. Деньги остались у вас.":
        "The bank has suspended operations on the recipient's card. Your money stayed with you.",
    "Если вас просили перевести срочно, позвоните в банк по номеру на обороте карты.":
        "If you were asked to send money urgently, call the bank at the number on the back of your card.",
    "Отменить перевод": "Cancel the transfer", "Отменить": "Cancel",
    "Позвонить в банк": "Call the bank", "Всё равно отправить": "Send anyway",
    "Продолжить перевод": "Continue the transfer", "Готово": "Done", "Закрыть": "Close",
    "Перевод отменён. Деньги остались на вашей карте.": "Transfer cancelled. Your money stayed on your card.",
    "Соединяем с банком. Не называйте коды из SMS никому, даже сотруднику банка.":
        "Connecting you to the bank. Never share SMS codes with anyone, even a bank employee.",
    "Перевод отправлен. Если поймёте, что это обман, сразу звоните в банк.":
        "Transfer sent. If you realise it was a scam, call the bank right away.",
    "Вы раньше не переводили деньги этому получателю.": "You have not sent money to this recipient before.",
    "Банк уже приостановил операции по этой карте.": "The bank has already suspended operations on this card.",
    "Та же обученная модель оценивает карту получателя по её движению денег за сутки до перевода. Деньги клиента ещё никуда не ушли.":
        "The same trained model scores the recipient's card by its money movement in the 24 hours before the transfer. The customer's money has not gone anywhere yet.",
    # имена на экране клиента (транслит)
    "Ерлан С.": "Yerlan S.", "Айдос Н.": "Aidos N.", "Данияр К.": "Daniyar K.", "Мадина Т.": "Madina T.",
    "Руслан Б.": "Ruslan B.", "Алия Ж.": "Aliya Zh.", "Нурлан А.": "Nurlan A.", "Асель М.": "Assel M.",
}

def _lower_variants() -> None:
    """Заголовки правил и схем в тексте встречаются и со строчной буквы (title.lower())."""
    for ru, en in list(EXACT.items()):
        if len(ru) > 8 and ru[0].isupper() and ru[1].islower():
            low = ru[0].lower() + ru[1:]
            if low not in EXACT:
                EXACT[low] = en[0].lower() + en[1:] if en[1:2].islower() else en


_lower_variants()

# ------------------------------------------------------------------ шаблоны
# (русский шаблон, английский шаблон)
RULES: List[Tuple[str, str]] = [
    # схемы и источники
    ("АФМ: куратор в Telegram вербует студентов ({x}); конвертация в крипту через «обменник» ({y})",
     "AFM: a Telegram curator recruits students ({x}); conversion to crypto through an \"exchanger\" ({y})"),
    ("Типология социнженерии; обнал через банкоматы, Алматы {a} млн ₸ ({x})",
     "Social engineering typology; cash-out through ATMs, Almaty ₸{a}M ({x})"),
    ("Типология мошенничества с предоплатой; доля интернет-мошенничества - {x}",
     "Prepayment fraud typology; share of online fraud - {x}"),
    ("Караганда: {a} дроп-счёта, {b} млн ₸, колл-офис {x} ({y})",
     "Karaganda: {a} drop {a?account|accounts}, ₸{b}M, call center {x} ({y})"),
    # профили
    ("молодые клиенты, быстрые лимиты, реакция {a} мин", "young customers, fast limits, {a} min reaction"),
    ("много пенсионеров, высокие лимиты, реакция {a} мин", "many pensioners, high limits, {a} min reaction"),
    # отчёт
    ("Первым шагом: {t}", "First step: {t}"),
    ("Самая дорогая дыра: {t}", "Costliest hole: {t}"),
    ("Найденная дыра: {t}", "Found hole: {t}"),
    ("На найденных дырах потери падают с {a} млн ₸ до {b} млн ₸ за сутки (минус {c}%). Цена: задержано {d} честных переводов на 10 тыс. вместо {e}, заморожено честных клиентов: {f} вместо {g}.",
     "On the found holes losses drop from ₸{a}M to ₸{b}M per day (down {c}%). Cost: {d} honest transfers delayed per 10k instead of {e}, honest customers frozen: {f} instead of {g}."),
    ("На найденных дырах потери падают с {a} млн ₸ до {b} ₸ за сутки (минус {c}%). Цена: задержано {d} честных переводов на 10 тыс. вместо {e}, заморожено честных клиентов: {f} вместо {g}.",
     "On the found holes losses drop from ₸{a}M to ₸{b} per day (down {c}%). Cost: {d} honest transfers delayed per 10k instead of {e}, honest customers frozen: {f} instead of {g}."),
    ("Дыры искались против текущих правил. Когда включена модель, ИИ-мошенник ищет заново и находит обход в {a} схемах из {b}: {c} млн ₸ за сутки. Защита без повторной проверки устаревает.",
     "The holes were searched against the current rules. With the model on, the AI fraudster searches again and finds a bypass in {a} of {b} schemes: ₸{c}M per day. A defense without a recheck goes stale."),
    ("Дыры искались против текущих правил. Когда включена модель, ИИ-мошенник ищет заново и находит обход в {a} схемах из {b}: {c} ₸ за сутки. Защита без повторной проверки устаревает.",
     "The holes were searched against the current rules. With the model on, the AI fraudster searches again and finds a bypass in {a} of {b} schemes: ₸{c} per day. A defense without a recheck goes stale."),
    ("Вариант ИИ-мошенника выводит {a} млн ₸ из {b} млн ₸ ({c}%), молчат {d} из {e} правил. Перепроверка на трёх других атаках: {f} млн ₸, {g} млн ₸, {h} млн ₸.",
     "The AI fraudster's variant cashes out ₸{a}M of ₸{b}M ({c}%); {d} of {e} rules stay silent. Rechecked on three other attacks: ₸{f}M, ₸{g}M, ₸{h}M."),
    ("Вариант ИИ-мошенника выводит {a} млн ₸ из {b} млн ₸ ({c}%), молчат {d} из {e} правил. Перепроверка на трёх других атаках: {f} млн ₸, {g} млн ₸, {h} ₸.",
     "The AI fraudster's variant cashes out ₸{a}M of ₸{b}M ({c}%); {d} of {e} rules stay silent. Rechecked on three other attacks: ₸{f}M, ₸{g}M, ₸{h}."),
    # подсказки дыры
    ("Жертвы платят частями по {a} ₸, ниже порога «новый получатель» {b} ₸. Считать сумму новому получателю за {c} [часа|часов|час], а не по одному переводу.",
     "Victims pay in parts of ₸{a}, below the \"new recipient\" threshold of ₸{b}. Sum the amount to a new recipient over {c} {c?hour|hours} instead of per single transfer."),
    ("Дроп-карты старше {a} дней (около {b}): правило «молодой счёт» молчит. Купленные «прогретые» карты его обходят.",
     "Drop cards are older than {a} days (around {b}), so the \"young account\" rule stays silent. Bought \"warmed-up\" cards get around it."),
    ("На одном телефоне {a} [карта|карты|карт], порог правила {b}. Связь видна только по графу.",
     "{a} {a?card|cards} on one phone, the rule threshold is {b}. The link is visible only in the graph."),
    ("Деньги уходят дальше через ~{a} мин, а жертва замечает пропажу в среднем через {b} ч.",
     "Money moves on after ~{a} min, while the victim notices the loss after {b} h on average."),
    ("Правила замечают все цепочки, но поздно: счёт замораживается через {a} мин после сигнала, а деньги к этому времени уже выведены. Нужна реакция в реальном времени.",
     "The rules spot every chain, but too late: the account is frozen {a} min after the alert, and the money is already out by then. Real-time reaction is needed."),
    ("Считать сумму новому получателю за {a} [часа|часов|час]",
     "Sum amounts to a new recipient over {a} {a?hour|hours}"),
    # причины риска (фрагменты предложений)
    ("Возраст карты отправителя: {a} [день|дня|дней]", "Sender card age: {a} {a?day|days}"),
    ("Возраст карты получателя: {a} [день|дня|дней]", "Recipient card age: {a} {a?day|days}"),
    ("На одном номере телефона {a} [карта|карты|карт]", "{a} {a?card|cards} on one phone number"),
    ("За сутки прислали {a} [новый отправитель|новых отправителя|новых отправителей]",
     "{a} new {a?sender|senders} sent money in the last 24 h"),
    ("Пришло {a} ₸ и через {b} {u} уходит дальше", "₸{a} arrived and moves on after {b} {u}"),
    ("Деньги с карты получателя уходят дальше через {a} {u}", "Money leaves the recipient's card after {a} {u}"),
    ("Первый перевод новому получателю: задержка {a} мин", "First transfer to a new recipient: held for {a} min"),
    # экран клиента
    ("Карте всего {a} [день|дня|дней].", "The card is only {a} {a?day|days} old."),
    ("На один номер телефона в банке оформлено {a} [карта|карты|карт] разных людей.",
     "{a} {a?card|cards} of different people are registered to one phone number at the bank."),
    ("За сутки на эту карту прислали деньги {a} [человек|человека|человек], которые раньше ей не переводили. Всего {b} ₸.",
     "In the last 24 hours {a} {a?person|people} who had never paid this card before sent it money. Total: ₸{b}."),
    ("За сутки на карту пришло {a} ₸ и примерно через {b} {u} ушло дальше. Деньги здесь не задерживаются.",
     "In the last 24 hours ₸{a} arrived on the card and moved on after about {b} {u}. Money does not stay here."),
    ("Деньги на эту карту приходят с карт, которые тоже сразу пересылают их дальше. Так выглядит цепочка дропов.",
     "Money reaches this card from cards that also forward it at once. This is what a drop chain looks like."),
    # модель
    ("leave-one-scheme-out: модель учится на {a} схемах и проверяется на пятой; уровень счёта (дроп или нет); деньги - атака пресета в демо-банке {b} клиентов",
     "leave-one-scheme-out: the model trains on {a} schemes and is tested on the fifth; account level (drop or not); money - the preset attack in a demo bank of {b} customers"),
    # ошибки
    ("Неизвестные параметры калибровки: {x}", "Unknown calibration parameters: {x}"),
    ("{t}: нужно число", "{t}: a number is required"),
    ("{t}: от {a} до {b}", "{t}: from {a} to {b}"),
    ("Суточный лимит не может быть меньше лимита одного перевода",
     "The daily limit cannot be lower than the single transfer limit"),
    ("Нет схемы {x}. Есть: {y}", "No such scheme: {x}. Available: {y}"),
]

# ------------------------------------------------------------------ движок
_NUM = r"\d+(?:[  ]\d{3})*(?:[.,]\d+)?"
_UNITS = {"мин": "min", "ч": "h"}
_PH = re.compile(r"\{([a-z])\}|\[([^\]]+)\]")


def _compile(ru: str):
    """Русский шаблон -> регулярка. Возвращает (regex, имена групп по порядку)."""
    out, pos = [], 0
    for m in _PH.finditer(ru):
        out.append(re.escape(ru[pos:m.start()]).replace("\\ ", r"[  ]"))
        if m.group(2) is not None:
            out.append("(?:" + "|".join(re.escape(x) for x in m.group(2).split("|")) + ")")
        else:
            n = m.group(1)
            if n == "u":
                out.append(r"(?P<u>мин|ч)")
            elif n in ("x", "y"):
                out.append(rf"(?P<{n}>[^;()]+?)" if n == "x" else rf"(?P<{n}>.+?)")
            elif n == "t":
                out.append(r"(?P<t>.+?)")
            else:
                out.append(rf"(?P<{n}>{_NUM})")
        pos = m.end()
    out.append(re.escape(ru[pos:]).replace("\\ ", r"[  ]"))
    return re.compile("^" + "".join(out) + "$", re.S)


_COMPILED = [(_compile(ru), en) for ru, en in RULES]


def _en_num(raw: str) -> str:
    grouped = bool(re.search(r"[  ]", raw))
    s = re.sub(r"[  ]", "", raw)
    if "," in s:
        s = s.replace(",", ".")
    ip, _, fp = s.partition(".")
    if grouped:
        ip = f"{int(ip):,}"
    return ip + ("." + fp if fp else "")


def _is_one(raw: str) -> bool:
    try:
        return float(re.sub(r"[  ]", "", raw).replace(",", ".")) == 1
    except ValueError:
        return False


_EN_PH = re.compile(r"\{([a-z])(?:\?([^}]+))?\}")


def _render(en: str, g: Dict[str, str], lang_tr) -> str:
    def sub(m):
        k, forms = m.group(1), m.group(2)
        v = g[k]
        if forms:
            one, many = forms.split("|")
            return one if _is_one(v) else many
        if k == "u":
            return _UNITS[v]
        if k == "t":
            return lang_tr(v)
        if k in ("x", "y"):
            return v
        return _en_num(v)
    return _EN_PH.sub(sub, en)


_SPLIT = re.compile(r"(?<=[a-zа-я0-9)»])\.\s+(?=[А-ЯЁA-Z])")


def _tr_one(s: str) -> str | None:
    if s in EXACT:
        return EXACT[s]
    for rx, en in _COMPILED:
        m = rx.match(s)
        if m:
            return _render(en, m.groupdict(), tr_text)
    return None


def tr_text(s: str) -> str:
    """Перевод одной строки на английский; нерусские строки возвращаются как есть."""
    if not _CYR.search(s):
        return s
    r = _tr_one(s)
    if r is not None:
        return r
    # составная строка: предложения по отдельности
    parts = _SPLIT.split(s)
    if len(parts) > 1:
        out = []
        for i, p in enumerate(parts):
            last = i == len(parts) - 1
            r = _tr_one(p)
            if r is None and not last:
                r = _tr_one(p + ".")
            if r is None and last and p.endswith("."):
                r = _tr_one(p[:-1])
                r = r + "." if r is not None else None
            if r is None:
                break
            out.append(r if r.endswith(".") or (last and not p.endswith(".")) else r + ".")
        else:
            return " ".join(out)
    if s.endswith("."):
        r = _tr_one(s[:-1])
        if r is not None:
            return r + "."
    MISSED.add(s)
    return s


def translate(obj: Any, lang: str) -> Any:
    """Глубокая копия ответа с переведёнными строками. lang=ru возвращает объект как есть."""
    if norm_lang(lang) == "ru":
        return obj
    return _walk(obj)


def _walk(o: Any) -> Any:
    if isinstance(o, str):
        return tr_text(o)
    if isinstance(o, list):
        return [_walk(v) for v in o]
    if isinstance(o, dict):
        return {k: _walk(v) for k, v in o.items()}
    return o


def t(s: str, lang: str) -> str:
    """Одна строка (сообщения об ошибках и т.п.)."""
    return tr_text(s) if norm_lang(lang) == "en" else s
