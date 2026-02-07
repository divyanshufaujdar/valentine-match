import csv
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
MATCHES_PATH = BASE / "matches.json"
MESSAGES_PATH = BASE / "messages.csv"

if not MATCHES_PATH.exists():
    raise SystemExit("matches.json not found")
if not MESSAGES_PATH.exists():
    raise SystemExit("messages.csv not found")

with MATCHES_PATH.open("r", encoding="utf-8") as f:
    data = json.load(f)

entries = data.get("entries", {})

with MESSAGES_PATH.open("r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        id_no = (row.get("ID") or "").strip().upper().replace(" ", "")
        msg = (row.get("MESSAGE") or "").strip()
        if not id_no or not msg:
            continue
        entry = entries.get(id_no)
        if entry:
            entry["message"] = msg

with MATCHES_PATH.open("w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print("Applied messages to matches.json")
