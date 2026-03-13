#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
يجمع ملفات عروض البنوك المحلية ويولّد all-offers.json.

الاستخدام المحلي:
  python update.py

الاستخدام عبر GitHub Actions:
- يشغّل السكربت داخل الريبو
- يعيد بناء all-offers.json من ملفات البنوك الموجودة
- إذا تغيّر الملف، يمكن للـ workflow عمل commit تلقائي

مهم:
- هذا السكربت لا يسحب من مواقع البنوك مباشرة.
- دوره الحالي: قراءة ملفات البنوك الموجودة في الريبو/المجلد محليًا وتوحيدها.
- لاحقًا يمكن توسيعه ليشمل scraping مباشر لكل بنك.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Dict, List

GENERATED_AT = datetime.now(ZoneInfo("Asia/Riyadh")).isoformat(timespec="seconds")
TODAY = GENERATED_AT[:10]
print("GENERATED_AT =", GENERATED_AT)

def log(msg: str) -> None:
    print(f"[update] {msg}")


def slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9\u0600-\u06FF]+", "-", text)
    return text.strip("-") or "offer"


def extract_date(text: str) -> str:
    if not text:
        return ""

    m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if m:
        return m.group(1)

    months = {
        "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4,
        "مايو": 5, "يونيو": 6, "يوليو": 7, "أغسطس": 8, "اغسطس": 8,
        "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
    }
    matches = re.findall(r"(\d{1,2})\s+([^\s]+)\s+(\d{4})", text)
    if matches:
        day, month_name, year = matches[-1]
        month_num = months.get(month_name)
        if month_num:
            return f"{int(year):04d}-{month_num:02d}-{int(day):02d}"

    return ""


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_bank_meta(data: Any) -> Dict[str, str]:
    if isinstance(data, list):
        return {
            "bank": "البنك السعودي للاستثمار",
            "bank_id": "saib",
            "source_page": "",
            "checked_at": "",
        }

    bank_obj = data.get("bank")

    if isinstance(bank_obj, dict):
        bank_name = bank_obj.get("bank_name_ar") or bank_obj.get("bank_name_en") or ""
        bank_id = (
            bank_obj.get("bank_id")
            or bank_obj.get("bank_slug")
            or data.get("bank_id")
            or data.get("bankCode")
            or data.get("bank_code")
            or slugify(bank_name)
        )
    else:
        bank_name = bank_obj or ""
        bank_id = (
            data.get("bank_id")
            or data.get("bankCode")
            or data.get("bank_code")
            or slugify(bank_name)
        )

    return {
        "bank": bank_name,
        "bank_id": bank_id,
        "source_page": data.get("source_page") or data.get("source") or data.get("source_url") or "",
        "checked_at": data.get("last_checked_at") or data.get("lastChecked") or data.get("extracted_at") or "",
    }


def normalize_offer(raw: Dict[str, Any], meta: Dict[str, str], index: int) -> Dict[str, Any]:
    bank = meta["bank"]
    bank_id = meta["bank_id"]

    if "offer_id" in raw or "merchant_name_ar" in raw:
        title = raw.get("merchant_name_ar") or raw.get("merchant_name_en") or raw.get("offer_id") or f"offer-{index}"
        merchant = raw.get("merchant_name_ar") or raw.get("merchant_name_en") or title
        discount = raw.get("discount_text") or (f"{raw.get('discount_value')}%" if raw.get("discount_value") else "")
        cards = raw.get("payment_methods") or []
        valid_from = raw.get("start_date") or ""
        valid_until = raw.get("end_date") or ""
        details = raw.get("terms_summary") or raw.get("notes") or ""
        source = raw.get("offer_url") or ""
        category = raw.get("category") or ""
        online = "e-commerce" in str(category).lower() or "online" in details.lower()
        expired = bool(valid_until and valid_until < TODAY)
        offer_id = raw.get("offer_id") or f"{bank_id}-{slugify(title)}-{index:03d}"
        code = ""
        country = ""
        city = ""

    elif "validity" in raw and "description" in raw:
        title = raw.get("title") or f"offer-{index}"
        merchant = title
        hay = f"{raw.get('description', '')} {raw.get('title', '')}"
        discount_match = re.search(r"(حتى\s*\d+%|\d+%)", hay)
        discount = discount_match.group(1) if discount_match else ""
        valid_until = extract_date(raw.get("validity", ""))
        valid_from = ""
        details = raw.get("description") or ""
        source = raw.get("url") or ""
        category = raw.get("category") or ""
        cards: List[str] = []
        code = ""
        country = ""
        city = ""
        online = False
        expired = bool(valid_until and valid_until < TODAY)
        offer_id = f"{bank_id}-{raw.get('id', index)}"

    else:
        title = raw.get("title") or raw.get("merchant") or f"offer-{index}"
        merchant = raw.get("merchant") or title
        discount = raw.get("discount") or ""
        details = raw.get("details") or raw.get("notes") or raw.get("cardText") or ""
        cards = raw.get("cards") or []
        code = raw.get("code") or raw.get("promoCode") or ""
        valid_from = raw.get("valid_from") or ""
        valid_until = raw.get("valid_until") or raw.get("expiryDate") or ""
        country = raw.get("country") or ""
        city = raw.get("city") or ""
        category = raw.get("category") or ""
        online = bool(raw.get("online", False))
        status = str(raw.get("status", "")).lower()
        expired = bool(raw.get("expired", False) or status == "expired" or (valid_until and valid_until < TODAY))
        source = raw.get("source") or raw.get("sourceUrl") or meta.get("source_page") or ""
        offer_id = str(raw.get("id") or f"{bank_id}-{slugify(title)}-{index:03d}")

    return {
        "id": offer_id,
        "bank": bank,
        "bank_id": bank_id,
        "title": title,
        "merchant": merchant,
        "category": category,
        "discount": discount,
        "details": details,
        "cards": cards if isinstance(cards, list) else ([cards] if cards else []),
        "code": code,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "country": country,
        "city": city,
        "online": bool(online),
        "expired": bool(expired),
        "source": source,
        "checked_at": meta.get("checked_at", ""),
    }


def collect_bank_files(search_dirs: List[Path]) -> List[Path]:
    preferred = [
        "Inma Offer.txt",
        "Riyadh Offer.txt",
        "Rajhi.txt",
        "Saib.json",
        "Saib.txt",
        "Ahli.txt",
        "AlJazira.txt",
        "ENBD.txt",
        "ANB.txt",
	"SABB.txt",

        "BSF.txt",
    ]

    found: List[Path] = []
    for base in search_dirs:
        for name in preferred:
            path = base / name
            if path.exists():
                found.append(path)

    unique: List[Path] = []
    seen = set()
    for path in found:
        key = str(path.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def main() -> None:
    root = Path(__file__).resolve().parent
    search_dirs = [root / "banks", root / "data" / "banks", root]
    existing_dirs = [p for p in search_dirs if p.exists()]
    output_file = root / "all-offers.json"

    bank_files = collect_bank_files(existing_dirs)
    if not bank_files:
        raise SystemExit("لم أجد أي ملفات بنوك. ضعها بجانب update.py أو داخل banks/ أو data/banks/")

    log(f"تاريخ التوليد: {TODAY}")
    log(f"مجلدات البحث: {', '.join(str(p.relative_to(root)) if p != root else '.' for p in existing_dirs)}")
    log(f"عدد ملفات البنوك المكتشفة: {len(bank_files)}")

    banks_summary: List[Dict[str, Any]] = []
    offers: List[Dict[str, Any]] = []

    selected_saib = None
    for d in existing_dirs:
        saib_json = d / "Saib.json"
        if saib_json.exists():
            selected_saib = saib_json.resolve()
            break

    for path in bank_files:
        if selected_saib and path.name == "Saib.txt":
            log(f"تخطي {path.name} لأن Saib.json موجود")
            continue

        data = load_json(path)
        meta = normalize_bank_meta(data)
        raw_offers = data["offers"] if isinstance(data, dict) and "offers" in data else data
        if not isinstance(raw_offers, list):
            raise ValueError(f"صيغة غير متوقعة في {path.name}: expected list of offers")

        banks_summary.append({
            "bank": meta["bank"],
            "bank_id": meta["bank_id"],
            "source_page": meta["source_page"],
            "checked_at": meta["checked_at"],
            "offers_count": len(raw_offers),
            "file": path.name,
        })
        log(f"{path.name}: {len(raw_offers)} عرض")

        for idx, raw in enumerate(raw_offers, start=1):
            offers.append(normalize_offer(raw, meta, idx))

    offers.sort(key=lambda x: (x.get("bank", ""), x.get("merchant", ""), x.get("title", "")))
    banks_summary.sort(key=lambda x: x["bank"])

    payload = {
        "generated_at": GENERATED_AT,
        "total_banks": len(banks_summary),
        "total_offers": len(offers),
        "banks": banks_summary,
        "offers": offers,
    }

    output_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"تم إنشاء {output_file.name}")
    log(f"إجمالي البنوك: {payload['total_banks']}")
    log(f"إجمالي العروض: {payload['total_offers']}")


if __name__ == "__main__":
    main()
