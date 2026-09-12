#!/usr/bin/env python3
"""Canlı demo sözleşme testi. Demo ayaktayken: npm run smoke"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

API = os.environ.get("API", "http://127.0.0.1:8088").rstrip("/")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "demo-admin-key")
USER_ID = os.environ.get("CREATE_USER_ID", "7")
CUSTOMER_ID = os.environ.get("CREATE_CUSTOMER_ID", "1")
FAILED = 0


def fail(msg: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {msg}")


def ok(msg: str) -> None:
    print(f"  OK    {msg}")


def request(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    bearer: str | None = None,
    admin: bool = False,
) -> tuple[int, Any]:
    req_headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req_headers["Content-Type"] = "application/json"
    if bearer:
        req_headers["Authorization"] = f"Bearer {bearer}"
    if admin:
        req_headers["X-Admin-Key"] = ADMIN_KEY
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(f"{API}{path}", data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode()
            payload: Any = json.loads(raw) if raw.strip() else None
            return resp.status, payload
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw) if raw.strip() else {"error": raw}
        except json.JSONDecodeError:
            payload = {"error": raw}
        return exc.code, payload
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"API yok ({API}): {exc.reason}\n"
            "Önce: docker compose -f examples/host-demo/docker-compose.yml up --build -d"
        ) from exc


def expect_status(got: int, want: int, label: str) -> None:
    if got == want:
        ok(f"{label} HTTP {got}")
    else:
        fail(f"{label} HTTP {got}, beklenen {want}")


def expect_eq(got: Any, want: Any, label: str) -> None:
    if got == want:
        ok(f"{label} = {want!r}")
    else:
        fail(f"{label} = {got!r}, beklenen {want!r}")


def wait_health(timeout: float) -> None:
    deadline = time.time() + timeout
    last = "no response"
    while time.time() < deadline:
        try:
            status, payload = request("GET", "/v1/health")
            if status == 200 and isinstance(payload, dict) and payload.get("status") == "ok":
                return
            last = f"HTTP {status} {payload}"
        except SystemExit as exc:
            last = str(exc).split("\n", 1)[0]
        time.sleep(1.5)
    raise SystemExit(f"health gelmedi ({timeout:.0f}s): {last}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Lead Capture canlı smoke")
    parser.add_argument("--wait", type=float, default=0, help="health için saniye (demo yeni açıldıysa)")
    args = parser.parse_args()

    print(f"API {API}")
    if args.wait > 0:
        print(f"health bekleniyor ({args.wait:.0f}s)…")
        wait_health(args.wait)

    print("\n== health ==")
    status, payload = request("GET", "/v1/health")
    expect_status(status, 200, "GET /v1/health")
    expect_eq((payload or {}).get("status"), "ok", "status")

    print("\n== auth reddi ==")
    status, payload = request("GET", "/v1/session")
    expect_status(status, 401, "GET /v1/session (bearer yok)")
    expect_eq((payload or {}).get("error"), "unauthorized", "error")

    status, payload = request(
        "POST",
        "/v1/tokens",
        body={"label": "bad", "create_user_id": USER_ID, "create_customer_id": CUSTOMER_ID},
        headers={"X-Admin-Key": "yanlis-key"},
    )
    expect_status(status, 401, "POST /v1/tokens (kötü admin)")

    print("\n== token + session ==")
    stamp = str(int(time.time()))
    status, payload = request(
        "POST",
        "/v1/tokens",
        admin=True,
        body={
            "label": f"smoke {stamp}",
            "create_user_id": int(USER_ID),
            "create_customer_id": int(CUSTOMER_ID),
        },
    )
    expect_status(status, 200, "POST /v1/tokens")
    token_meta = (payload or {}).get("token") or {}
    secret = (payload or {}).get("secret") or ""
    if not secret.startswith("dgext_"):
        fail("secret dgext_ ile başlamıyor")
    else:
        ok("secret prefix dgext_")
    if not token_meta.get("id"):
        fail("token.id yok")
    else:
        ok(f"token.id = {token_meta.get('id')}")

    status, payload = request("GET", "/v1/session", bearer=secret)
    expect_status(status, 200, "GET /v1/session")
    expect_eq(str((payload or {}).get("create_user_id")), USER_ID, "create_user_id")
    expect_eq(str((payload or {}).get("create_customer_id")), CUSTOMER_ID, "create_customer_id")
    expect_eq((payload or {}).get("name"), "Acme Ltd", "name")
    expect_eq((payload or {}).get("providers"), ["linkedin"], "providers")

    print("\n== leads ==")
    ada = f"https://www.linkedin.com/in/smoke-ada-{stamp}"
    grace = f"https://www.linkedin.com/in/smoke-grace-{stamp}"
    status, payload = request(
        "POST",
        "/v1/leads",
        bearer=secret,
        body={
            "provider": "linkedin",
            "page_url": "https://www.linkedin.com/search/results/people/?keywords=smoke",
            "leads": [
                {
                    "name": "Ada Lovelace",
                    "profile_url": ada,
                    "title": "Engineer",
                    "company": "Analytical Engines",
                    "location": "London",
                    "headline": "Mathematician",
                },
                {
                    "name": "Grace Hopper",
                    "profile_url": grace,
                    "title": "Rear Admiral",
                    "company": "US Navy",
                    "email": "grace@example.com",
                    "about": "COBOL pioneer",
                },
            ],
        },
    )
    expect_status(status, 200, "POST /v1/leads (create)")
    expect_eq((payload or {}).get("created"), 2, "created")
    expect_eq((payload or {}).get("merged"), 0, "merged")
    expect_eq((payload or {}).get("skipped"), 0, "skipped")

    status, payload = request(
        "POST",
        "/v1/leads",
        bearer=secret,
        body={
            "provider": "linkedin",
            "leads": [
                {
                    "name": "Ada Lovelace",
                    "profile_url": ada,
                    "email": "ada@example.com",
                    "about": "First programmer",
                }
            ],
        },
    )
    expect_status(status, 200, "POST /v1/leads (upsert)")
    expect_eq((payload or {}).get("created"), 0, "created")
    expect_eq((payload or {}).get("merged"), 1, "merged")

    status, payload = request("POST", "/v1/leads", bearer=secret, body={"provider": "linkedin", "leads": []})
    expect_status(status, 400, "POST /v1/leads (boş)")
    expect_eq((payload or {}).get("error"), "leads_required", "error")

    status, payload = request("GET", f"/v1/leads?q=smoke-ada-{stamp}", bearer=secret)
    expect_status(status, 200, "GET /v1/leads Ada")
    ada_row = next((row for row in (payload or {}).get("items") or [] if row.get("profile_url") == ada), None)

    status, payload = request("GET", f"/v1/leads?q=smoke-grace-{stamp}", bearer=secret)
    expect_status(status, 200, "GET /v1/leads Grace")
    grace_row = next((row for row in (payload or {}).get("items") or [] if row.get("profile_url") == grace), None)

    if not ada_row:
        fail("Ada listede yok")
    else:
        expect_eq(ada_row.get("enrich_status"), "enriched", "Ada enrich_status")
        expect_eq(ada_row.get("email"), "ada@example.com", "Ada email")
        expect_eq(ada_row.get("ai_status"), "none", "Ada ai_status")

    if not grace_row:
        fail("Grace listede yok")
    else:
        expect_eq(grace_row.get("enrich_status"), "enriched", "Grace enrich_status")

    if ada_row and ada_row.get("id"):
        lead_id = ada_row["id"]
        status, payload = request(
            "PATCH",
            f"/v1/leads/{lead_id}",
            bearer=secret,
            body={"ai_status": "done"},
        )
        expect_status(status, 200, "PATCH /v1/leads/{id}")
        expect_eq((payload or {}).get("ok"), True, "ok")
        status, payload = request("GET", f"/v1/leads?q=smoke-ada-{stamp}", bearer=secret)
        expect_status(status, 200, "GET Ada after PATCH")
        patched = next((row for row in (payload or {}).get("items") or [] if row.get("id") == lead_id), None)
        if not patched:
            fail("PATCH sonrası Ada yok")
        else:
            expect_eq(patched.get("ai_status"), "done", "Ada ai_status after PATCH")
    else:
        fail("PATCH atlandı (Ada id yok)")

    print("\n== linkedin pipeline → leads ==")
    search_url = f"https://www.linkedin.com/in/li-search-{stamp}"
    profile_url = search_url
    csv_url = f"https://www.linkedin.com/in/li-csv-{stamp}"
    company_url = f"https://www.linkedin.com/company/li-acme-{stamp}"

    status, payload = request(
        "POST",
        "/v1/leads",
        bearer=secret,
        body={
            "provider": "linkedin",
            "page_url": "https://www.linkedin.com/search/results/people/?keywords=engineer",
            "leads": [
                {
                    "name": "Ada Lovelace",
                    "profile_url": search_url,
                    "linkedin_url": search_url,
                    "title": "Engineer",
                    "company": "Analytical Engines",
                    "location": "London, United Kingdom",
                    "headline": "Engineer at Analytical Engines",
                }
            ],
        },
    )
    expect_status(status, 200, "POST search listed")
    expect_eq((payload or {}).get("created"), 1, "search created")

    status, payload = request("GET", f"/v1/leads?q=li-search-{stamp}", bearer=secret)
    expect_status(status, 200, "GET search listed")
    search_row = next((row for row in (payload or {}).get("items") or [] if row.get("profile_url") == search_url), None)
    if not search_row:
        fail("search lead leads tablosunda yok")
    else:
        expect_eq(search_row.get("enrich_status"), "listed", "search enrich_status")
        expect_eq(search_row.get("company"), "Analytical Engines", "search company")

    status, payload = request(
        "POST",
        "/v1/leads",
        bearer=secret,
        body={
            "provider": "linkedin",
            "page_url": profile_url,
            "leads": [
                {
                    "name": "Ada Lovelace",
                    "profile_url": profile_url,
                    "linkedin_url": profile_url,
                    "title": "Engineer",
                    "company": "Analytical Engines",
                    "location": "London, United Kingdom",
                    "email": "ada@example.com",
                    "about": "First programmer and mathematician working on the Analytical Engine.",
                }
            ],
        },
    )
    expect_status(status, 200, "POST profile enrich")
    expect_eq((payload or {}).get("merged"), 1, "profile merged")

    status, payload = request("GET", f"/v1/leads?q=li-search-{stamp}", bearer=secret)
    expect_status(status, 200, "GET after profile enrich")
    enriched = next((row for row in (payload or {}).get("items") or [] if row.get("profile_url") == profile_url), None)
    if not enriched:
        fail("profile enrich sonrası lead yok")
    else:
        expect_eq(enriched.get("enrich_status"), "enriched", "profile enrich_status")
        expect_eq(enriched.get("email"), "ada@example.com", "profile email")
        expect_eq(enriched.get("id"), search_row.get("id") if search_row else None, "aynı lead id")

    status, payload = request(
        "POST",
        "/v1/leads",
        bearer=secret,
        body={
            "provider": "linkedin",
            "page_url": "https://www.linkedin.com/mynetwork/invite-connect/connections/",
            "leads": [
                {
                    "name": "Jane Doe",
                    "profile_url": csv_url,
                    "linkedin_url": csv_url,
                    "email": "jane@example.com",
                    "company": "Acme",
                    "title": "CEO",
                }
            ],
        },
    )
    expect_status(status, 200, "POST Connections.csv")
    expect_eq((payload or {}).get("created"), 1, "csv created")

    status, payload = request(
        "POST",
        "/v1/leads",
        bearer=secret,
        body={
            "provider": "linkedin",
            "page_url": company_url,
            "leads": [
                {
                    "name": "Acme Ltd",
                    "profile_url": company_url,
                    "linkedin_url": company_url,
                    "company": "Acme Ltd",
                    "website": "https://acme.example",
                    "about": "We build widgets for the modern age and ship worldwide to partners.",
                    "location": "Istanbul",
                }
            ],
        },
    )
    expect_status(status, 200, "POST company page")
    expect_eq((payload or {}).get("created"), 1, "company created")

    status, payload = request(
        "POST",
        "/v1/leads",
        bearer=secret,
        body={
            "provider": "linkedin",
            "leads": [{"name": "Ghost"}, {"company": "NoURL Inc"}],
        },
    )
    expect_status(status, 200, "POST invalid skip")
    expect_eq((payload or {}).get("skipped"), 2, "invalid skipped")
    expect_eq((payload or {}).get("created"), 0, "invalid created")

    status, payload = request("GET", f"/v1/leads?q=li-csv-{stamp}", bearer=secret)
    csv_row = next((row for row in (payload or {}).get("items") or [] if row.get("profile_url") == csv_url), None)
    if not csv_row:
        fail("CSV lead leads tablosunda yok")
    else:
        expect_eq(csv_row.get("enrich_status"), "enriched", "csv enrich_status")
        expect_eq(csv_row.get("email"), "jane@example.com", "csv email")

    status, payload = request("GET", f"/v1/leads?q=li-acme-{stamp}", bearer=secret)
    company_row = next((row for row in (payload or {}).get("items") or [] if row.get("profile_url") == company_url), None)
    if not company_row:
        fail("company lead leads tablosunda yok")
    else:
        expect_eq(company_row.get("enrich_status"), "enriched", "company enrich_status")
        expect_eq(company_row.get("name"), "Acme Ltd", "company name")

    print("\n== admin tokens ==")
    status, payload = request("GET", "/v1/tokens", admin=True)
    expect_status(status, 200, "GET /v1/tokens")
    if not isinstance(payload, list):
        fail("token listesi dizi değil")
    else:
        found = any((row or {}).get("id") == token_meta.get("id") for row in payload)
        if found:
            ok("üretilen token listede")
        else:
            fail("üretilen token listede yok")

    print()
    if FAILED:
        print(f"SMOKE FAIL  ({FAILED} hata)")
        return 1
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
