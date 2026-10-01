# FUJI Cycle Count Sheet Generator

Static inventory-count sheet generator with a searchable master product catalog.

## Master Catalog

The SKU/barcode lookup lazily downloads compressed catalog shards from `master-index/`. To rebuild them after updating the workbook, run:

```sh
python3 scripts/build_master_search.py "ITEM MASTER AS OF 09-02-2026 1.xlsx" master-index --description-output master-description-index
```

The builder indexes the `HYPERMART` and `GOMART` product sheets, including SKU, UPC, description, supplier, department, and category hierarchy. It also builds a compact description index for the lookup's Description search mode. Keep the original workbook local; the website only needs the generated search shards.

To rebuild only the description index, run:

```sh
python3 scripts/build_master_search.py "ITEM MASTER AS OF 09-02-2026 1.xlsx" --description-only --description-output master-description-index
```

## Hotlist Shift Lookup

`hotlist_inventory.json` defines the hotlist rows and their categories. Replace the demo items with the store's actual SKUs. Keep SKUs as strings to preserve leading zeroes; use `MILK`, `CIGARETTES`, or `LIQUORS` for `category`. Each row includes item details, a direct image URL, and starting count values. Leave `price` and `locator` empty to populate them from the masterfile.

Open Hotlist from the top navigation and upload `PRICE AND LOCATOR CODES.xlsx`. The importer joins `Sku` / `Retail Cost` and `sku_no` / `locator_code` columns by SKU, supports multiple locators per SKU, and caches the imported mapping in that browser. Product photos use each row's direct `image_url` first, then try an exact barcode lookup in Open Food Facts. If neither provides a photo, the card shows a Google Images link for the product. Shift edits are saved locally as you type, and Save Shift Data also logs a complete snapshot to the browser console.

Withdrawal Qty is the cumulative quantity withdrawn so far for the shift. Log Withdrawal transfers only the amount not already applied, so clicking it again does not double-count stock. Serve the project through a static web server (for example, GitHub Pages) so the JSON and catalog files can be fetched.