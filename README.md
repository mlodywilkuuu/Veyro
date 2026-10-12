# Veyro

Panel rozwoju i repozytorium bota Discord **Veyro**.

## Status projektu

| Element | Stan |
|---|---|
| Wersja | `2.0.0` |
| Główna gałąź | `main` |
| AutoModeracja | ✅ rozwinięta |
| Permisje komend | ✅ gotowe |
| Radio 24/7 | ✅ gotowe |
| Rekrutacja | ✅ gotowe |
| Status panel | ✅ gotowe |
| Integracja panelu | 🟡 w przygotowaniu |

## Jak prowadzimy zmiany

Każda większa zmiana powinna mieć Issue. Statusy pracy:

1. 💡 Pomysł
2. 📋 Do zrobienia
3. 🚧 W trakcie
4. 🧪 Testy
5. ✅ Gotowe
6. 🚀 Wydane

## Deploy slash komend

Jeżeli zmienia się schemat komend, ustaw na jeden restart:

```env
DEPLOY_COMMANDS=true
```

Po wdrożeniu wróć na:

```env
DEPLOY_COMMANDS=false
```

## Bezpieczeństwo

Nie commituj `.env`, tokenu Discorda ani plików runtime z konfiguracją serwera.

## Panel bota

Kod Veyro zapisuje lokalny `panel-state.json` z wersją, listą komend i stanem modułów. Ten plik jest przeznaczony jako dane dla przyszłego panelu/deploya.
