# Turmalin - mock API (opcjonalne)

> **Domyślnie używaj Django** (`python manage.py runserver` + `run.bat`).
> Mock API to kopia offline - do testów bez bazy SQLite.

Lekki serwer Express. Każdy zakład ma przypisane silniki w **`api/models.py`** (Django) - mock duplikuje te dane w `data/factories.js`.

## Uruchomienie mocka (opcjonalnie)

```bash
cd mock-api && npm start   # port 3001
```

W `frontend/vite.config.js` ustaw proxy `target: 'http://localhost:3001'`.

## Django (źródło prawdy)

- `Factory` - zakład (nazwa, adres, zdjęcie, typ)
- `DemoEngine` - silniki **przypisane do konkretnego zakładu** (`ForeignKey`)
- Seed: migracja `0002_seed_factories`
- API: `http://localhost:8000/api/factories/`
