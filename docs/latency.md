# Gate verification latency

Measured 2026-10-11 13:06 UTC with `scripts/measure_latency.py` against `http://localhost:8000`.
Face provider: **demo** · machine: x86_64, 8 CPUs, Linux 7.2.8-100.fc43.x86_64 · Python 3.14.7.
Target from PROJECT_SPEC: full verification < **800 ms**.

Client = round trip measured by the script (HTTP + server). Server columns come from the
`Server-Timing` header: `face` = face provider search, `db` = locked entry transaction + log.

| Scenario | n | client p50 | client p95 | client p99 | client max | server face p50 | server db p50 | server total p95 | < 800 ms (p95) |
|---|---|---|---|---|---|---|---|---|---|
| face_first_entry | 1 | 14.4 ms | 14.4 ms | 14.4 ms | 14.4 ms | 0.9 ms | 4.8 ms | 10.1 ms | ✓ |
| face_rescan | 100 | 7.9 ms | 8.9 ms | 9.3 ms | 11.1 ms | 0.5 ms | 1.9 ms | 5.7 ms | ✓ |
| face_unknown | 100 | 7.3 ms | 8.0 ms | 8.7 ms | 8.9 ms | 0.5 ms | — | 5.0 ms | ✓ |
| qr_entry | 100 | 5.8 ms | 7.3 ms | 8.0 ms | 8.3 ms | — | 2.6 ms | 3.8 ms | ✓ |
| face_10_parallel | 100 | 51.6 ms | 112.3 ms | 125.2 ms | 127.5 ms | 3.6 ms | 11.9 ms | 47.8 ms | ✓ |

Scenarios:

- **face_first_entry**: Face, first scan: search + lock + VALID→ENTERED + log. Results: ['APPROVED']
- **face_rescan**: Face, re-scan of the same person: search + lock + ALREADY_ENTERED + log. Results: ['ALREADY_ENTERED']
- **face_unknown**: Face, nobody enrolled for the event: search, NOT_RECOGNIZED + log. Results: ['NOT_RECOGNIZED']
- **qr_entry**: QR fallback, first entry of each ticket: lookup + lock + ENTERED + log. Results: ['APPROVED']
- **face_10_parallel**: Face re-scans from 10 gates at once (contention on one ticket row). Results: ['ALREADY_ENTERED']

## Interpretation

- **These numbers are our own overhead.** With `FACE_PROVIDER=demo` the face step is a local
  file lookup (`server face` ≈ 0.5 ms). Everything else is real: HTTP, auth, rate limiting,
  image validation, the locked entry transaction and the access-log insert.
- **The entry transaction is cheap:** `server db` p50 ≈ 2–5 ms for `SELECT … FOR UPDATE` +
  status update + log insert. Denials found before any ticket (e.g. `face_unknown`) only write a
  log row, which is not part of the measured `db` step, hence "—".
- **Contention:** 10 gates scanning the same ticket at once wait for each other on the row lock,
  so the tail grows (client p95 ≈ 110 ms instead of ≈ 9 ms). That waiting is exactly what
  guarantees a single entry, and it stays far below the target.
- **With real AWS Rekognition** the `face` step becomes a network call (DetectFaces is not used at
  the gate, only SearchFacesByImage). Expect a few hundred milliseconds depending on region and
  image size; that budget fits under 800 ms with our ≈ 10 ms overhead, but it must be measured:

  ```bash
  # .env: FACE_PROVIDER=rekognition + AWS keys; restart the backend
  cd backend && .venv/bin/python -m scripts.measure_latency --photo /path/to/your-face.jpg --report ../docs/latency.md
  ```

- The gate terminal adds its own time before the request (motion detection runs every 300 ms,
  JPEG capture ≈ tens of ms) and after it (drawing the result). The spec's "entry < 1 second"
  is end to end; the table above is the server side plus local HTTP.
