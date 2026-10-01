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

`master-details.json` contains only SKU, price, and locator values and is loaded automatically by catalog search and Hotlist. Rebuild it after replacing the local, gitignored workbook:

```sh
python3 scripts/build_price_locator_index.py
```

The importer joins `Sku` / `Retail Cost` and `sku_no` / `locator_code` columns by SKU and supports multiple locators per SKU. The full workbook remains gitignored; only the reduced mapping is published. Hotlist can still load a workbook manually for browser-local updates. Product photos use each row's direct `image_url` first, then try an exact barcode lookup in Open Food Facts. If neither provides a photo, the card shows a Google Images link for the product. Shift edits are saved locally as you type, and Save Shift Data also logs a complete snapshot to the browser console.

Withdrawal Qty is the cumulative quantity withdrawn so far for the shift. Log Withdrawal transfers only the amount not already applied, so clicking it again does not double-count stock. Serve the project through a static web server (for example, GitHub Pages) so the JSON and catalog files can be fetched.

## Announcements

Announcements are read-only for visitors and load from `comments.json`. Administrators publish updates by editing that JSON file with records containing `id`, `date`, `author`, `title`, and `message`, then publishing the site.

The standalone login page uses two browser-local test accounts: `admin` / `admin123` and `user` / `user123`. Administrators can create additional `admin` or `user` accounts. Passwords are PBKDF2-hashed in local storage and sign-in state is kept in session storage. Local announcements published in the app are shared by tabs in the same browser profile and take precedence alongside the published feed.

This is a convenience and UI restriction for a static site, not secure server authentication: account records, roles, inventory, and announcements are local to one browser profile and can be inspected or changed by that profile's owner. There is no cross-device account or announcement synchronization and no server-side authorization. Use a trusted managed device; do not store sensitive data here.

## Masterlist View

Open Masterlist from the top navigation and upload a Pcount monitoring workbook. The importer reads `CC Masterlist` plus `CC Sched`, `CC Variance Details`, and `IRA% IRA Summary` when present. Parsed master rows and available secondary sheets are stored in this browser's IndexedDB and restored on reload. The dashboard filters CCD and department, searches SKU/description/vendor fields, sorts by column, and renders 50 or 100 rows per page. Uploaded workbook contents are not uploaded to the website.