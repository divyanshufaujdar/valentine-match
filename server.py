import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Use Azure App Service persistent storage if available
PERSIST_DIR = '/home' if os.path.isdir('/home') else BASE_DIR
DATA_FILE = os.environ.get('PAYMENTS_PATH', os.path.join(PERSIST_DIR, 'payments.json'))
MATCHES_FILE = os.path.join(BASE_DIR, 'matches.json')
PORT = int(os.environ.get('PORT', '8000'))


def read_json(path, fallback):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fallback


def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)


def normalize_id(value):
    return ''.join(str(value or '').split()).upper()


MATCHES = read_json(MATCHES_FILE, {}).get('entries', {})
BLOCKED_IDS = {
    "2025A5PS1503P",
}


def load_payments():
    return read_json(DATA_FILE, {"records": {}})


def save_payments(data):
    write_json(DATA_FILE, data)


def normalize_record(record):
    if not record:
        return None
    pending = record.get('pending_count')
    credits = record.get('credits')
    used = record.get('used_count')
    if pending is None and credits is None and used is None and 'status' in record:
        status = record.get('status')
        if status == 'pending':
            pending, credits, used = 1, 0, 0
        elif status == 'approved':
            pending, credits, used = 0, 1, 0
        elif status == 'used':
            pending, credits, used = 0, 0, 1
        else:
            pending, credits, used = 0, 0, 0
    else:
        pending = int(pending or 0)
        credits = int(credits or 0)
        used = int(used or 0)

    record['pending_count'] = pending
    record['credits'] = credits
    record['used_count'] = used
    return record


def compute_status(record):
    if not record:
        return "none"
    if record.get('credits', 0) > 0:
        return "approved"
    if record.get('pending_count', 0) > 0:
        return "pending"
    return "none"


class Handler(SimpleHTTPRequestHandler):
    def _send_json(self, status, payload):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode('utf-8')
        try:
            return json.loads(raw)
        except Exception:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/status':
            query = parse_qs(parsed.query)
            id_value = normalize_id(query.get('id', [''])[0])
            payments = load_payments()
            record = normalize_record(payments['records'].get(id_value))
            if not record:
                return self._send_json(200, {"status": "none"})
            status = compute_status(record)
            return self._send_json(200, {"status": status, "record": record})

        if parsed.path == '/api/admin/pending':
            payments = load_payments()
            pending = []
            for r in payments['records'].values():
                rec = normalize_record(r)
                if rec and rec.get('pending_count', 0) > 0:
                    pending.append(rec)
            return self._send_json(200, {"pending": pending})

        if parsed.path == '/rose':
            self.path = '/rose.html'
            return super().do_GET()

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        body = self._read_body()
        if body is None:
            return self._send_json(400, {"error": "Invalid JSON."})

        if parsed.path == '/api/submit-payment':
            id_value = normalize_id(body.get('id'))
            payer_name = str(body.get('name') or '').strip()
            if not id_value:
                return self._send_json(400, {"error": "ID is required."})
            if id_value in BLOCKED_IDS:
                return self._send_json(403, {"error": "This ID is not allowed to access the site."})
            if not payer_name:
                return self._send_json(400, {"error": "Name is required."})
            if id_value not in MATCHES:
                return self._send_json(404, {"error": "ID not found in matches."})

            payments = load_payments()
            existing = normalize_record(payments['records'].get(id_value))
            now = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
            if existing:
                existing['pending_count'] = existing.get('pending_count', 0) + 1
                existing['name'] = payer_name
                existing['lastSubmittedAt'] = now
                payments['records'][id_value] = existing
            else:
                payments['records'][id_value] = {
                    "id": id_value,
                    "name": payer_name,
                    "utr": str(body.get('utr') or '').strip(),
                    "pending_count": 1,
                    "credits": 0,
                    "used_count": 0,
                    "lastSubmittedAt": now
                }
            save_payments(payments)
            record = normalize_record(payments['records'][id_value])
            return self._send_json(200, {
                "status": compute_status(record),
                "pending_count": record['pending_count'],
                "credits": record['credits'],
                "used_count": record['used_count']
            })

        if parsed.path == '/api/lookup':
            id_value = normalize_id(body.get('id'))
            if not id_value:
                return self._send_json(400, {"error": "ID is required."})
            if id_value in BLOCKED_IDS:
                return self._send_json(403, {"error": "This ID is not allowed to access the site."})

            payments = load_payments()
            record = normalize_record(payments['records'].get(id_value))
            if not record:
                return self._send_json(403, {"error": "Payment not submitted."})
            if record.get('pending_count', 0) > 0 and record.get('credits', 0) <= 0:
                return self._send_json(403, {"error": "Payment pending approval."})
            if record.get('credits', 0) <= 0:
                return self._send_json(403, {"error": "No approved payment credit available."})

            entry = MATCHES.get(id_value)
            if not entry:
                return self._send_json(404, {"error": "ID not found in matches."})

            record['credits'] = record.get('credits', 0) - 1
            record['used_count'] = record.get('used_count', 0) + 1
            record['lastUsedAt'] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
            payments['records'][id_value] = record
            save_payments(payments)
            return self._send_json(200, {
                "entry": entry,
                "credits_left": record['credits'],
                "used_count": record['used_count']
            })

        if parsed.path == '/api/admin/approve':
            id_value = normalize_id(body.get('id'))
            payments = load_payments()
            record = normalize_record(payments['records'].get(id_value))
            if not record:
                return self._send_json(404, {"error": "No payment found."})
            if record.get('pending_count', 0) <= 0:
                return self._send_json(400, {"error": "No pending payment to approve."})
            record['pending_count'] = record.get('pending_count', 0) - 1
            record['credits'] = record.get('credits', 0) + 1
            record['approvedAt'] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
            payments['records'][id_value] = record
            save_payments(payments)
            return self._send_json(200, {
                "status": "approved",
                "pending_count": record['pending_count'],
                "credits": record['credits']
            })

        return self._send_json(404, {"error": "Not found."})


if __name__ == '__main__':
    os.chdir(BASE_DIR)
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f"Server running at http://0.0.0.0:{PORT}")
    server.serve_forever()
