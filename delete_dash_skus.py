"""
Finds duplicate UPC barcodes across all Shopify variants and deletes
any variant whose SKU contains a dash. If all variants in a duplicate
group have a dash, all are deleted.
"""

import json
import os
import time
import urllib.request
import urllib.error

STORE = "la-bicicletta-vancouver.myshopify.com"
TOKEN_FILE = ".token.json"
API_BASE = f"https://{STORE}/admin/api/2024-01"


def load_token():
    token = os.environ.get("SHOPIFY_TOKEN")
    if token:
        return token
    with open(TOKEN_FILE) as f:
        return json.load(f)["token"]


def shopify_get(token, path):
    url = f"{API_BASE}{path}"
    req = urllib.request.Request(url, headers={"X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req) as resp:
        link = resp.headers.get("Link", "")
        data = json.loads(resp.read())
    return data, link


def shopify_delete(token, path):
    url = f"{API_BASE}{path}"
    req = urllib.request.Request(
        url, method="DELETE", headers={"X-Shopify-Access-Token": token}
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status


def get_all_products(token):
    products = []
    path = "/products.json?limit=250&fields=id,title,variants,images"

    while path:
        data, link = shopify_get(token, path)
        products.extend(data["products"])
        path = None
        if 'rel="next"' in link:
            for part in link.split(","):
                if 'rel="next"' in part:
                    url = part.split(";")[0].strip().strip("<>")
                    path = url.replace(f"https://{STORE}/admin/api/2024-01", "")
        print(f"  Fetched {len(products)} products so far...", end="\r")

    print()
    return products


def main():
    token = load_token()
    print("Loading products...")
    products = get_all_products(token)
    print(f"Total products: {len(products)}")

    # Group variants by barcode
    barcode_map = {}
    for product in products:
        for variant in product["variants"]:
            barcode = (variant.get("barcode") or "").strip()
            if not barcode:
                continue
            barcode_map.setdefault(barcode, []).append({
                "barcode": barcode,
                "product_id": product["id"],
                "product_title": product["title"],
                "variant_id": variant["id"],
                "variant_title": variant["title"],
                "sku": variant.get("sku") or "",
            })

    # Find duplicate barcodes where at least one SKU has a dash
    duplicates = [
        (barcode, variants)
        for barcode, variants in barcode_map.items()
        if len(variants) > 1 and any("-" in v["sku"] for v in variants)
    ]

    if not duplicates:
        print("No matching duplicates found.")
        return

    print(f"\nFound {len(duplicates)} duplicate UPC group(s) with dashed SKUs:\n")

    deleted = 0
    skipped = 0

    for barcode, variants in sorted(duplicates):
        to_delete = [v for v in variants if "-" in v["sku"]]
        to_keep   = [v for v in variants if "-" not in v["sku"]]

        print(f"UPC: {barcode}")
        for v in to_keep:
            print(f"  KEEP   {v['product_title']} | {v['variant_title']} | SKU: {v['sku'] or '(none)'}")
        for v in to_delete:
            print(f"  DELETE {v['product_title']} | {v['variant_title']} | SKU: {v['sku']}")

        for v in to_delete:
            try:
                status = shopify_delete(
                    token, f"/products/{v['product_id']}/variants/{v['variant_id']}.json"
                )
                print(f"  Deleted variant {v['variant_id']} (status {status})")
                deleted += 1
                time.sleep(0.5)  # stay well within rate limits
            except urllib.error.HTTPError as e:
                print(f"  ERROR deleting {v['variant_id']}: {e.code} {e.reason}")
        print()

    print(f"Done. Deleted: {deleted}")


if __name__ == "__main__":
    main()
