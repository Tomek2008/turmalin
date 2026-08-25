"""Pobiera zdjęcia zakładów do frontend/public/factories/."""
import json
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Tytuły plików na Wikimedia Commons (licencje wolne)
WIKI_FILES = {
    "cmc-zawiercie": "Electric arc furnace.jpg",
    "orlen-plock": "Rafineria Płock - panoramio.jpg",
    "celsa-ostrowiec": "ArcelorMittal Poland Steel mill (former Nowa Huta Lenin Steel mill), Gate No. 1, Ujastek 1 street, Nowa Huta, Krakow, Poland.JPG",
    "pge-belchatow": "Belchatow-elektrownia.jpg",
}

OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "factories"
API_HEADERS = {"User-Agent": "TurmalinBot/1.0 (demo; contact: demo@example.com)"}
THUMB_WIDTH = 960
CURL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def wiki_thumb_url(filename: str) -> str:
    title = f"File:{filename}"
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|thumburl",
            "iiurlwidth": str(THUMB_WIDTH),
            "format": "json",
        }
    )
    req = urllib.request.Request(
        f"https://commons.wikimedia.org/w/api.php?{params}",
        headers=API_HEADERS,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)

    page = next(iter(data["query"]["pages"].values()))
    if "missing" in page:
        raise ValueError(f"Brak pliku na Commons: {filename}")

    info = page.get("imageinfo", [{}])[0]
    url = info.get("thumburl") or info.get("url")
    if not url:
        raise ValueError(f"Brak URL dla: {filename}")
    return url.split("?")[0]


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            "curl.exe",
            "-L",
            "-sS",
            "-A",
            CURL_UA,
            "-H",
            "Referer: https://commons.wikimedia.org/",
            "-o",
            str(dest),
            url,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"curl exit {result.returncode}")
    if not dest.exists() or dest.stat().st_size < 1024:
        raise RuntimeError("Pobrany plik jest pusty lub za mały")
    if dest.read_bytes()[:2] != b"\xff\xd8":
        dest.unlink(missing_ok=True)
        raise RuntimeError("Pobrany plik nie jest JPEG (prawdopodobnie błąd serwera)")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for slug, filename in WIKI_FILES.items():
        dest = OUT_DIR / f"{slug}.jpg"
        try:
            url = wiki_thumb_url(filename)
            time.sleep(2)
            download(url, dest)
            print(f"{slug}: OK ({dest.stat().st_size} bytes)")
            print(f"  <- {url}")
        except Exception as exc:
            print(f"{slug}: FAIL {exc}")


if __name__ == "__main__":
    main()
