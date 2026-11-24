# Авторство 3D-моделей и компонентов

Все модели лежат локально в `public/models/` (сжаты gltf-transform: meshopt + webp, текстуры до 512 px). Скачаны 23.11.2026.

## CC-BY 3.0 (обязательна строка авторства)

| Файл | Модель | Автор | Источник | Лицензия |
|---|---|---|---|---|
| `atm.glb` | ATM | J-Toastie | https://poly.pizza/m/p4U0tSF5WN | CC-BY 3.0, https://creativecommons.org/licenses/by/3.0/ |
| `server.glb` | server rack | Jeremy Eyring | https://poly.pizza/m/6ijQclm8jxw | CC-BY 3.0, https://creativecommons.org/licenses/by/3.0/ |

Изменения: геометрия сжата, материалы заменены на палитру проекта (слоновая кость, бронза, графит).
Строка авторства показана в подвале отчёта (`src/Report.tsx`).

## CC0 1.0 (авторство не требуется, указываем из уважения)

| Файл | Модель | Автор | Источник |
|---|---|---|---|
| `camera.glb` | Security Camera 01 | Alexander Otterbeck, риг Yann Kervran | https://polyhaven.com/a/security_camera_01 |
| `laptop.glb` | Classic Laptop | Arrangemonk | https://polyhaven.com/a/classic_laptop |
| `coin.glb` | Coin | Quaternius | https://poly.pizza/m/QHZtj94fvh |
| `coinpiles.glb` | Coin Piles | Quaternius | https://poly.pizza/m/9OWkKczINo |
| `man.glb` | Man in Suit | Quaternius | https://poly.pizza/m/mQnGoME1ez |

## Код

- drei, @react-three/fiber, @react-three/postprocessing, postprocessing: MIT.
- Рамка «живой карточки» (`.beam` в `src/index.css`): своя CSS-версия приёма BorderBeam из Magic UI (MIT), код не копировался.
- Код AGPL (Maybe, Midday) не использован.
