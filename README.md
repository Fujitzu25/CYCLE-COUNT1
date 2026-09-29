# FUJI Cycle Count Sheet Generator

Static inventory-count sheet generator with a searchable master product catalog.

## Master Catalog

The SKU/barcode lookup lazily downloads compressed catalog shards from `master-index/`. To rebuild them after updating the workbook, run:

```sh
python3 scripts/build_master_search.py "ITEM MASTER AS OF 09-02-2026 1.xlsx" master-index
```

The builder indexes the `HYPERMART` and `GOMART` product sheets, including SKU, UPC, description, supplier, department, and category hierarchy. Keep the original workbook local; the website only needs the generated search shards.