#!/usr/bin/env python3
"""Build the public SKU-to-price-and-locator JSON from the local workbook."""

import argparse
import json
import posixpath
import re
import zipfile
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
SKU_HEADERS = {"sku", "sku no", "sku number", "product code"}
PRICE_HEADERS = {"retail cost", "retail price", "price", "selling price", "unit price"}
LOCATOR_HEADERS = {"locator code", "locator", "location", "bin location", "aisle bin"}


def normalize_header(value):
    value = str(value or "").lower().replace("&", " and ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value).strip())


def normalize_sku(value):
    return re.sub(r"\.0$", "", str(value or "").strip()).upper()


def column_number(reference):
    number = 0
    for character in reference:
        if not character.isalpha():
            break
        number = number * 26 + ord(character.upper()) - ord("A") + 1
    return number - 1


def load_shared_strings(archive):
    try:
        source = archive.open("xl/sharedStrings.xml")
    except KeyError:
        return []
    strings = []
    with source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag == f"{{{MAIN_NS}}}si":
                strings.append("".join(part.text or "" for part in element.iter() if part.tag == f"{{{MAIN_NS}}}t"))
                element.clear()
    return strings


def cell_value(cell, strings):
    if cell.attrib.get("t") == "inlineStr":
        return "".join(part.text or "" for part in cell.iter() if part.tag == f"{{{MAIN_NS}}}t")
    value = cell.find(f"{{{MAIN_NS}}}v")
    if value is None or value.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        return strings[int(value.text)]
    return value.text


def sheet_paths(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships}
    paths = []
    for sheet in workbook.findall(f".//{{{MAIN_NS}}}sheet"):
        target = targets[sheet.attrib[f"{{{REL_NS}}}id"]]
        path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
        paths.append((sheet.attrib["name"], path))
    return paths


def format_price(value):
    value = str(value or "").strip()
    try:
        number = Decimal(value)
        return f"{number:,.2f}" if number.is_finite() else value
    except InvalidOperation:
        return value


def read_rows(archive, path, strings):
    with archive.open(path) as source:
        for _, row in ET.iterparse(source, events=("end",)):
            if row.tag != f"{{{MAIN_NS}}}row":
                continue
            values = {}
            for cell in row.findall(f"{{{MAIN_NS}}}c"):
                values[column_number(cell.attrib.get("r", "A"))] = cell_value(cell, strings)
            yield values
            row.clear()


def build_index(workbook_path):
    details = {}
    with zipfile.ZipFile(workbook_path) as archive:
        strings = load_shared_strings(archive)
        for _, path in sheet_paths(archive):
            sku_column = price_column = locator_column = None
            header_rows = 0
            for row in read_rows(archive, path, strings):
                if sku_column is None:
                    header_rows += 1
                    if header_rows > 20:
                        break
                    headers = {column: normalize_header(value) for column, value in row.items()}
                    sku_column = next((column for column, value in headers.items() if value in SKU_HEADERS), None)
                    price_column = next((column for column, value in headers.items() if value in PRICE_HEADERS), None)
                    locator_column = next((column for column, value in headers.items() if value in LOCATOR_HEADERS), None)
                    if sku_column is not None and (price_column is not None or locator_column is not None):
                        continue
                    sku_column = None
                    continue

                sku = normalize_sku(row.get(sku_column, ""))
                if not sku:
                    continue
                record = details.setdefault(sku, {"price": "", "locator": ""})
                price = row.get(price_column, "") if price_column is not None else ""
                if price and not record["price"]:
                    record["price"] = format_price(price)
                locator = str(row.get(locator_column, "") or "").strip() if locator_column is not None else ""
                if locator:
                    locators = list(filter(None, record["locator"].split(" / ")))
                    if locator not in locators:
                        locators.append(locator)
                    record["locator"] = " / ".join(locators)
    return {sku: record for sku, record in details.items() if record["price"] or record["locator"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", nargs="?", default="PRICE AND LOCATOR CODES.xlsx")
    parser.add_argument("output", nargs="?", default="master-details.json")
    args = parser.parse_args()
    details = build_index(args.workbook)
    with open(args.output, "w", encoding="utf-8") as destination:
        json.dump(details, destination, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(details):,} SKUs to {args.output}")


if __name__ == "__main__":
    main()