#!/usr/bin/env python3
"""Build the public default masterlist JSON from the local monitoring workbook."""

import argparse
from datetime import datetime, timedelta
import gzip
import json
import os
import posixpath
import re
import zipfile
from xml.etree import ElementTree as ET

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
FIELDS = {
    "ccd": ("ccd no", "ccd", "ccd number", "ccd#"),
    "sku": ("sku",),
    "description": ("sku description", "description", "item description"),
    "deptCode": ("dept code", "department code", "dept"),
    "department": ("department",),
    "subdeptName": ("subdept name", "sub department name", "subdept"),
    "classification": ("classification",),
    "vendorName": ("vendor name", "supplier name"),
    "barcode": ("barcode", "upc", "upc barcode", "ean", "gtin"),
}


def normalize_header(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9#]+", " ", str(value or "").lower())).strip()


def normalize_sku(value):
    return re.sub(r"\.0$", "", str(value or "").strip())


def normalize_lookup_sku(value):
    return re.sub(r"[^A-Z0-9]", "", normalize_sku(value).upper())


def column_number(reference):
    number = 0
    for character in reference:
        if not character.isalpha():
            break
        number = number * 26 + ord(character.upper()) - ord("A") + 1
    return number - 1


def parse_other_sheet(matrix):
    aliases = {normalize_header(alias) for names in FIELDS.values() for alias in names}
    header_index = next(
        (
            index
            for index, row in enumerate(matrix[:40])
            if len(aliases.intersection(normalize_header(value) for value in row)) >= 3
        ),
        -1,
    )
    if header_index < 0:
        header_index = next((index for index, row in enumerate(matrix) if any(str(value).strip() for value in row)), -1)
    if header_index < 0:
        return {"headers": [], "rows": []}

    header_row = matrix[header_index]
    populated = sum(bool(str(value).strip()) for value in header_row)
    if populated < 2:
        rows = [
            [index + 1, " · ".join(str(value).strip() for value in row if str(value).strip())]
            for index, row in enumerate(matrix)
            if any(str(value).strip() for value in row)
        ]
        return {"headers": ["Row", "Value"], "rows": rows}

    headers = [str(value).strip() or f"Column {index + 1}" for index, value in enumerate(header_row)]
    seen = {}
    for index, header in enumerate(headers):
        count = seen.get(header, 0) + 1
        seen[header] = count
        if count > 1:
            headers[index] = f"{header} ({count})"

    rows = []
    for row in matrix[header_index + 1 :]:
        if not any(str(value).strip() for value in row):
            continue
        values = list(row[: len(headers)]) + [""] * max(0, len(headers) - len(row))
        for index, header in enumerate(headers):
            if "date" not in normalize_header(header):
                continue
            try:
                serial = float(values[index])
            except (TypeError, ValueError):
                continue
            if serial >= 20000:
                values[index] = (datetime(1899, 12, 30) + timedelta(days=serial)).strftime("%m/%d/%Y")
        rows.append(values)
    return {"headers": headers, "rows": rows}


def load_shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(part.text or "" for part in item.iter(f"{{{MAIN_NS}}}t"))
        for item in root.findall(f"{{{MAIN_NS}}}si")
    ]


def cell_value(cell, strings):
    if cell.attrib.get("t") == "inlineStr":
        return "".join(part.text or "" for part in cell.iter(f"{{{MAIN_NS}}}t"))
    value = cell.find(f"{{{MAIN_NS}}}v")
    if value is None or value.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        return strings[int(value.text)]
    return value.text


def load_product_barcodes(index_dir, skus):
    wanted = {normalize_lookup_sku(sku) for sku in skus if normalize_lookup_sku(sku)}
    prefixes = {sku[:2] for sku in wanted if len(sku) >= 2}
    barcodes = {}
    for prefix in prefixes:
        path = os.path.join(index_dir, f"{prefix}.json.gz")
        if not os.path.isfile(path):
            continue
        with gzip.open(path, "rt", encoding="utf-8") as source:
            for row in json.load(source):
                sku = normalize_lookup_sku(row[0])
                barcode = str(row[1] or "").strip()
                if sku in wanted and barcode:
                    barcodes.setdefault(sku, barcode)
    return barcodes


def load_master_records(workbook_path, locator_index, product_index_dir):
    with zipfile.ZipFile(workbook_path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {
            item.attrib["Id"]: item.attrib["Target"]
            for item in relationships.findall(f"{{{PKG_NS}}}Relationship")
        }
        master_sheet = next(
            sheet
            for sheet in workbook.findall(f".//{{{MAIN_NS}}}sheet")
            if sheet.attrib["name"].strip().lower() == "cc masterlist"
        )
        target = targets[master_sheet.attrib[f"{{{REL_NS}}}id"]].lstrip("/")
        sheet_path = target if target.startswith("xl/") else posixpath.join("xl", target)
        strings = load_shared_strings(archive)
        sheet = ET.fromstring(archive.read(sheet_path))
        records = []
        indexes = None
        for row in sheet.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
            values = {
                column_number(cell.attrib["r"]): cell_value(cell, strings)
                for cell in row.findall(f"{{{MAIN_NS}}}c")
            }
            if indexes is None:
                headers = {}
                for index, value in values.items():
                    headers.setdefault(normalize_header(value), index)
                indexes = {
                    field: next((headers[normalize_header(alias)] for alias in aliases if normalize_header(alias) in headers), -1)
                    for field, aliases in FIELDS.items()
                }
                if indexes["sku"] < 0 or indexes["deptCode"] < 0:
                    raise ValueError("CC Masterlist is missing SKU or Dept Code headers.")
                continue
            record = {
                field: str(values.get(index, "") or "").strip() if index >= 0 else ""
                for field, index in indexes.items()
            }
            if not record["sku"] and not record["description"]:
                continue
            details = locator_index.get(normalize_sku(record["sku"]), {})
            record["locator"] = str(details.get("locator", "") or "").strip()
            records.append(record)
        barcodes = load_product_barcodes(product_index_dir, [record["sku"] for record in records])
        for record in records:
            record["barcode"] = record["barcode"] or barcodes.get(normalize_lookup_sku(record["sku"]), "")
        additional_sheets = {}
        sheet_index = 0
        for sheet_info in workbook.findall(f".//{{{MAIN_NS}}}sheet"):
            if sheet_info.attrib["name"] == master_sheet.attrib["name"]:
                continue
            sheet_index += 1
            sheet_target = targets[sheet_info.attrib[f"{{{REL_NS}}}id"]].lstrip("/")
            sheet_file = sheet_target if sheet_target.startswith("xl/") else posixpath.join("xl", sheet_target)
            sheet_root = ET.fromstring(archive.read(sheet_file))
            matrix = []
            for row in sheet_root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
                cells = {
                    column_number(cell.attrib["r"]): cell_value(cell, strings)
                    for cell in row.findall(f"{{{MAIN_NS}}}c")
                }
                if cells:
                    matrix.append([cells.get(index, "") for index in range(max(cells) + 1)])
                else:
                    matrix.append([])
            additional_sheets[f"sheet{sheet_index}"] = {"name": sheet_info.attrib["name"], **parse_other_sheet(matrix)}
        return records, additional_sheets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", nargs="?", default="14014 Cauayan Pcount Monitoring 2026 (2).xlsx")
    parser.add_argument("--locator-index", default="master-details.json")
    parser.add_argument("--product-index-dir", default="master-index")
    parser.add_argument("--output", default="masterlist-default.json")
    args = parser.parse_args()

    with open(args.locator_index, encoding="utf-8") as source:
        locator_index = json.load(source)
    dataset = {
        "sourceName": args.workbook,
        "records": (master_data := load_master_records(args.workbook, locator_index, args.product_index_dir))[0],
        "sheets": master_data[1],
    }
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(dataset, output, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(dataset['records']):,} shared masterlist rows to {args.output}.")


if __name__ == "__main__":
    main()