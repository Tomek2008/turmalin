# Turmalin: diagnostyka akustyczna silników Diesla

Narzędzie dla inżynierów i mechaników Aesteel: z widma akustycznego wtrysku paliwa (0–20 kHz) rozpoznaje stan cylindra, szacuje nasilenie usterki i pokazuje, *dlaczego* padł taki werdykt.

Projekt jest rozdzielony na dwa repozytoria:

| Rola | Repozytorium |
|---|---|
| Aplikacja produkcyjna (UI + serwowanie diagnozy) | **to repozytorium**: [turmalin](https://github.com/Tomek2008/turmalin) |
| Badania, modele, ewaluacja, predykcje | [hackaton_engin_ml](https://github.com/janpopowicz/hackaton_engin_ml) (submoduł `hackaton_engin_ml/`) |

Regulamin zadania, format danych i kryteria oceny: [`hackaton_engin_ml/zasady.md`](hackaton_engin_ml/zasady.md).

## Oddanie

Plik predykcji na `test.csv` (format zgodny z `sample_submit.csv`):

**[`predictions.csv`](predictions.csv)**

```csv
engine_id,cylinder,label,severity
test_0000,1,ok,nie_dotyczy
```

Kolumny: `engine_id`, `cylinder`, `label`, `severity`.
Dla `ok` i `unknown` nasilenie jest zawsze `nie_dotyczy`; dla pozostałych klas: `male` / `srednie` / `duze`.

Źródło: `hackaton_engin_ml/predictions_hybrid.csv` po ręcznym rozstrzygnięciu konfliktów (`hackaton_engin_ml/labelowanie/`).

## Rozwiązanie

Klasyfikacja usterki i ocena nasilenia to dwa różne problemy, więc nie wrzucamy ich do jednego modelu.

```
widmo cylindra (mV_0 … mV_20)
        │
        ├── TabPFN ──────────────────────────►  klasa
        │                                        (ok / zakoksowany / lejący /
        │                                         pompa / iglica / unknown)
        │
        └── model widmowy GLRT ──────────────►  nasilenie
            rzut residuum na szablon klasy        (amplituda w mV → male/srednie/duże)
            + korekta jittera wzmocnienia
        │
        └── rozjazdy TabPFN vs GLRT ─────────►  przegląd ręczny (kilka cylindrów)
                                              ▼
                                   predictions.csv
```

**Klasa: TabPFN.** Tabular foundation model uczony na etykietowanym `val_full.csv`. W walidacji leave-one-engine-out (LOEO) ma macro-F1 **0.991**, praktycznie sufit zadania (symulacja generatora daje rozróżnialność klas ~0.9999).

**Nasilenie: analiza widma (GLRT).** Generatywny model

```
widmo[cyl] = (1 + g) · profil_silnika + a · szablon(klasa) + szum(σ)
```

Nasilenie to amplituda `a` (rzut residuum na kierunek usterki), nie norma `||r||`. Norma zawiera szum i jitter wzmocnienia (~5%), więc przy usterkach `male` mierzy głównie zakłócenie. Rzut jest nieobciążony; przedziały `male` / `srednie` / `duze` odpowiadają mnożnikom ~1 / ~1.45 / ~2.0. Brakujące prążki są maskowane, nie interpolowane.

**Rozjazdy: człowiek.** Na teście modele zgadzały się w klasie w 99.3% cylindrów. Pozostałe konflikty (klasa albo nasilenie na granicy progu) zostały przejrzane na wykresach widma i residuum; w kilku pojedynczych przypadkach werdykt poprawił człowiek. Ślad tej pracy: [`hackaton_engin_ml/labelowanie/`](hackaton_engin_ml/labelowanie/).

Każdy werdykt GLRT jest wielkością fizyczną: nazwa szablonu, amplituda w mV, istotność w sigmach, χ² dopasowania, podświetlone pasmo kHz. To idzie prosto do UI.

## Modele porównawcze

Zanim powstała hybryda, te same fałdy LOEO dostały:

| Model | Rola |
|---|---|
| Las losowy | baseline na cechach sygnatur (dołek 9 kHz, odbicie 12 kHz, L2 vs profil silnika, …) |
| TabPFN | nauczyciel: klasyfikacja |
| Drzewo destylowane po TabPFN | student: TabPFN etykietuje `train.csv`, płytkie drzewo sklearn uczy się na nazwanych cechach (CPU, ścieżka if/then) |
| Model widmowy (GLRT) | detekcja + nasilenie z amplitudy |
| **Hybryda TabPFN + GLRT** | **rozwiązanie końcowe** |

## Wynik (LOEO na `val_full.csv`)

40 silników, 476 cylindrów, 69 usterek. Na etykiety nałożone te same ~5% luk pomiarowych co w `test.csv`. Wzorce, progi i decyzje liczone wyłącznie na silnikach treningowych fałdy.

Metryka konkursowa: `Raw_Score = 0.75 · Macro-F1(label) + 0.25 · Accuracy(severity | usterka)`.

| Model | Macro-F1 | Sev. acc. | Raw score | 95% CI |
|---|---:|---:|---:|---|
| Drzewo destylowane | 0.867 | 0.825 | 0.856 | [0.767, 0.915] |
| Las losowy | 0.908 | 0.807 | 0.883 | [0.808, 0.941] |
| TabPFN | 0.991 | 0.895 | 0.967 | [0.944, 0.987] |
| Model widmowy (GLRT) | 0.990 | 0.947 | 0.979 | [0.945, 1.000] |
| **Hybryda TabPFN + GLRT** | **0.991** | **0.965** | **0.985** | **[0.961, 1.000]** |

Hybryda vs sam TabPFN: ΔRaw = +0.018 (całość z nasilenia: 6 błędów → 2). Klasa jest remisem: wszystkie trzy najlepsze warianty mylą jeden cylinder z 476. Szczegóły, bootstrap i zastrzeżenia: [`hackaton_engin_ml/wyniki.txt`](hackaton_engin_ml/wyniki.txt).

## Uruchomienie aplikacji

Działa na CPU, bez GPU. Warstwa inferencji: `numpy`, `pandas`, bez PyTorcha, bez TabPFN, bez sklearn.

### Szybki start (Windows)

```bat
run.bat
```

Backend: `http://127.0.0.1:8000/api/`  
Frontend: `http://localhost:5173`

### Ręcznie

Python 3.10+, Node.js 18+.

```bash
pip install django djangorestframework django-cors-headers numpy pandas

python manage.py migrate
python manage.py runserver
```

W drugim terminalu:

```bash
cd frontend
npm install
npm run dev
```

Aplikacja ładuje artefakt GLRT (`backend/spectral_glrt.pkl`) przy starcie:

```python
from glrt_serve import load, predict

model = load()                 # backend/spectral_glrt.pkl, raz przy starcie
payload = predict(engine_df)   # kolumny engine_id, cylinder, mV_0 … mV_20
```

Luki (`NaN`) zostawić jak są: model je maskuje.

## Jak uzyskać `predictions.csv`

Python 3.10+, środowisko z [`hackaton_engin_ml/requirements-tabpfn.txt`](hackaton_engin_ml/requirements-tabpfn.txt). Całość dzieje się w submodule ML:

```bash
cd hackaton_engin_ml
pip install -r requirements-tabpfn.txt

# 1. TabPFN: klasy na teście → predictions_tabpfn.csv
python tabpfn_diagnose.py

# 2. submit_hybrid.py: klasa z TabPFN + nasilenie z GLRT → predictions_hybrid.csv
python submit_hybrid.py
```

`submit_hybrid.py` składa idealne rozwiązanie: czyta `predictions_tabpfn.csv` (klasy) i dopisuje nasilenie z modelu widmowego GLRT. Domyślnie zapisuje `predictions_hybrid.csv`. Równoważne wywołanie:


```bash
pip install -r requirements-tabpfn.txt

# 1. TabPFN: klasy na teście → predictions_tabpfn.csv
python tabpfn_diagnose.py

# 2. GLRT: nasilenie na klasach TabPFN → predictions_hybrid.csv
python submit_hybrid.py --labels-from predictions_tabpfn.csv --out predictions_hybrid.csv
```

`final_predictions.csv` to `predictions_hybrid.csv` po ręcznym rozstrzygnięciu konfliktów (`labelowanie/`). dlatego jak chce ktoś mechaniczne to musi użyc
`predictions.csv` to nie ludzkie a prawdziwe automatyczne dobre

Ewaluacja LOEO (odtworzenie tabeli):

```bash
python evaluate_loeo.py
```

Lokalny prototyp UI na destylowanym drzewie (nie jest aplikacją konkursową):

```bash
streamlit run app_tabpfn.py
```

Ewaluacja LOEO (odtworzenie tabeli):

```bash
cd hackaton_engin_ml
python evaluate_loeo.py
```

## Struktura

```
predictions.csv           ← plik oddania (test.csv)
README.md                 ← to, co czytasz
run.bat                   ← start Django + Vite

api/                      Django REST (zakłady, silniki, diagnoza)
backend/                  ustawienia Django + glrt_serve.py + spectral_glrt.pkl
frontend/                 React + Vite
hackaton_engin_ml/        badania, TabPFN, ewaluacja, zasady.md
```
