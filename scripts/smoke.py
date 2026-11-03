#!/usr/bin/env python3
"""Dgmos backend lead-capture sözleşme testi.

Gerçek tenant'a test lead'leri yazar (profil URL'leri `smoke-` ile başlar). Test/sandbox
tenant'ında çalıştırın:

    DGMOS_API=https://sandbox.dgmos.com/api DGMOS_KEY=dg_ak_pub_... npm run smoke
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

API = os.environ.get("DGMOS_API", "https://sandbox.dgmos.com/api").rstrip("/")
KEY = os.environ.get("DGMOS_KEY", "")
FAILED = 0


def fail(msg: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {msg}")


def ok(msg: str) -> None:
    print(f"  OK    {msg}")


def call(path: str, body: dict[str, Any] | None = None, *, key: str | None = KEY) -> tuple[int, Any]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        # Public access keys require a browser-like Origin (the extension sends chrome-extension://…).
        "Origin": "chrome-extension://dgmos-lead-capture-smoke",
    }
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body or {}).encode(), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return exc.code, {"error": raw}
    except urllib.error.URLError as exc:
        raise SystemExit(f"API'ye ulaşılamadı ({API}): {exc.reason}") from exc


def expect(got: Any, want: Any, label: str) -> None:
    if got == want:
        ok(f"{label} = {want!r}")
    else:
        fail(f"{label} = {got!r}, beklenen {want!r}")


def find(items: list[dict[str, Any]], profile_url: str) -> dict[str, Any] | None:
    return next((it for it in items if it.get("profile_url") == profile_url), None)


def main() -> int:
    if not KEY:
        print("DGMOS_KEY gerekli (Lead Capture route'larına yetkili public access key).")
        return 2
    stamp = str(int(time.time()))
    ada = f"https://www.linkedin.com/in/smoke-ada-{stamp}"
    acme = f"https://www.linkedin.com/company/smoke-acme-{stamp}"
    print(f"API: {API}")

    status, _ = call("/modules/lead-capture-session", key=None)
    expect(status, 401, "session (key yok) HTTP")
    status, body = call("/modules/lead-capture-session")
    expect(status, 200, "session HTTP")
    if not body.get("create_customer_id"):
        fail("session create_customer_id boş")

    status, body = call("/modules/lead-capture", {"provider": "linkedin", "leads": []})
    expect(status, 400, "boş batch HTTP")

    # 1) Liste aşaması: büyük harf + alt sayfa + query ile gelen URL tek profile normalize edilmeli.
    listed = {
        "provider": "linkedin",
        "page_url": "https://www.linkedin.com/search/results/people/",
        "leads": [
            {"name": "Ada  Lovelace", "profile_url": ada.replace("smoke-ada", "Smoke-Ada") + "/?trk=x",
             "headline": "Lojistik Müdürü"},
            {"name": "Acme Lojistik", "profile_url": acme + "/about/"},
            {"name": "Ada Lovelace", "profile_url": ada},  # aynı batch'te tekrar → atlanır
            {"name": "", "profile_url": ""},  # geçersiz → atlanır
        ],
    }
    status, body = call("/modules/lead-capture", listed)
    expect(status, 200, "liste aktarımı HTTP")
    expect((body.get("created"), body.get("skipped"), body.get("failed")), (2, 2, 0), "created/skipped/failed")

    # 2) Aynı liste tekrar → değişiklik yok, hepsi atlanır.
    status, body = call("/modules/lead-capture", listed)
    expect((body.get("created"), body.get("merged")), (0, 0), "tekrar aktarım created/merged")

    # 3) Zenginleştirme: şirket + iletişim gelir → güncellenir, ENRICHED olur.
    enriched = {
        "provider": "linkedin",
        "leads": [{
            "name": "Ada Lovelace", "profile_url": ada, "company": "Acme Lojistik",
            "title": "Lojistik Müdürü", "email": "Ada@Example.com", "about": "20 yıl deneyim",
            "location": "İstanbul, Türkiye", "enrich_status": "enriched",
        }],
    }
    status, body = call("/modules/lead-capture", enriched)
    expect((body.get("created"), body.get("merged")), (0, 1), "zenginleştirme created/merged")

    status, body = call("/modules/lead-capture-list", {"q": f"smoke-ada-{stamp}", "limit": 10})
    expect(status, 200, "liste HTTP")
    item = find(body.get("items", []), ada)
    if not item:
        fail("Ada listede yok")
    else:
        expect(item.get("name"), "Ada Lovelace", "Ada name")
        expect(item.get("company"), "Acme Lojistik", "Ada company (kişi adı yerine gerçek şirket)")
        expect(item.get("email"), "ada@example.com", "Ada email")
        expect(item.get("location"), "İstanbul, Türkiye", "Ada location")
        expect(item.get("enrich_status"), "enriched", "Ada enrich_status")

    status, body = call("/modules/lead-capture-list", {"q": f"smoke-acme-{stamp}", "limit": 10})
    item = find(body.get("items", []), acme)
    if not item:
        fail("Acme listede yok")
    else:
        expect(item.get("name"), "Acme Lojistik", "Acme name (şirket sayfası)")

    status, body = call("/modules/lead-capture-list", {"enrich_status": "listed", "sort": "oldest", "limit": 1})
    expect(status, 200, "enrich kuyruğu HTTP")
    totals = body.get("totals", {})
    if totals.get("all", 0) < totals.get("listed", 0) + totals.get("enriched", 0):
        fail(f"totals tutarsız: {totals}")
    else:
        ok(f"totals {totals.get('all')} = listed {totals.get('listed')} + enriched {totals.get('enriched')}")

    print("\nSONUÇ:", "BAŞARILI" if FAILED == 0 else f"{FAILED} HATA")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
