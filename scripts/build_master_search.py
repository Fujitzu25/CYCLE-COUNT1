#!/usr/bin/env python3
"""Build lazy-loaded gzip search shards from the product master workbook."""

import argparse
import gzip
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
SHEETS = {"HYPERMART", "GOMART"}
REQUIRED_COLUMNS = (
    "PRODUCT_CODE",
    "PRODUCT_DESCRIPTION",
    "UPC",
    "PROD_LEVEL1_DESC",
    "PROD_LEVEL2_DESC",
    "PROD_LEVEL3_DESC",
    "PROD_LEVEL4_DESC",
    "VENDOR_COMPANY_NAME",
)


def column_number(reference):
    number = 0
    for character in reference:
        if not character.isalpha():
            break
        number = number * 26 + ord(character.upper()) - ord("A") + 1
    return number - 1


def load_shared_strings(archive):
    strings = []
    with archive.open("xl/sharedStrings.xml") as source:
        for _, element in ET.iterparse(source, events=("end",)):
            if element.tag == f"{{{MAIN_NS}}}si":
                strings.append("".join(part.text or "" for part in element.iter() if part.tag == f"{{{MAIN_NS}}}t"))
                element.clear()
    return strings


def cell_value(cell, strings):
    value = cell.find(f"{{{MAIN_NS}}}v")
    if cell.attrib.get("t") == "inlineStr":
        return "".join(part.text or "" for part in cell.iter() if part.tag == f"{{{MAIN_NS}}}t")
    if value is None or value.text is None:
        return ""
    if cell.attrib.get("t") == "s":
        return strings[int(value.text)]
    return value.text


def clean(value):
    value = str(value or "").strip()
    return "" if value.upper() in {"NULL", "NONE", "N/A"} else value


def search_prefix(value):
    normalized = re.sub(r"[^A-Z0-9]", "", value.upper())
    return normalized[:2] or "__"


def get_sheet_paths(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {item.attrib["Id"]: item.attrib["Target"].lstrip("/") for item in relationships}
    return {
        sheet.attrib["name"]: "xl/" + targets[sheet.attrib[f"{{{REL_NS}}}id"]]
        for sheet in workbook.findall(f".//{{{MAIN_NS}}}sheet")
        if sheet.attrib["name"] in SHEETS
    }


def open_shard(output_dir, prefix, writers, counts):
    if prefix not in writers:
        os.makedirs(output_dir, exist_ok=True)
        path = os.path.join(output_dir, f"{prefix}.json.gz")
        writers[prefix] = gzip.open(path, "wt", encoding="utf-8", newline="")
        writers[prefix].write("[")
        counts[prefix] = 0
    return writers[prefix]


def write_shard_record(output_dir, row, writers, counts):
    sku, barcode = row[0], row[1]
    prefixes = {search_prefix(sku)}
    if barcode:
        prefixes.add(search_prefix(barcode))
    for prefix in prefixes:
        writer = open_shard(output_dir, prefix, writers, counts)
        if counts[prefix]:
            writer.write(",")
        json.dump(row, writer, ensure_ascii=False, separators=(",", ":"))
        counts[prefix] += 1


def write_description_record(output_dir, row, writers, counts):
    words = set(re.findall(r"[A-Z0-9]+", row[2].upper()))
    compact_row = [row[0], row[2]]
    for prefix in {search_prefix(word) for word in words if word}:
        writer = open_shard(output_dir, prefix, writers, counts)
        if counts[prefix]:
            writer.write(",")
        json.dump(compact_row, writer, ensure_ascii=False, separators=(",", ":"))
        counts[prefix] += 1


def clear_shards(output_dir):
    os.makedirs(output_dir, exist_ok=True)
    for name in os.listdir(output_dir):
        if name.endswith(".json.gz"):
            os.remove(os.path.join(output_dir, name))


def build(workbook_path, output_dir=None, description_output_dir=None, description_only=False):
    if description_only and not description_output_dir:
        raise ValueError("--description-only requires --description-output.")
    if not description_only:
        if not output_dir:
            raise ValueError("A catalog output directory is required unless --description-only is used.")
        clear_shards(output_dir)
    if description_output_dir:
        clear_shards(description_output_dir)
    writers = {}
    counts = {}
    description_writers = {}
    description_counts = {}
    total = 0
    try:
        with zipfile.ZipFile(workbook_path) as archive:
            print("Loading shared strings...", flush=True)
            strings = load_shared_strings(archive)
            sheet_paths = get_sheet_paths(archive)
            if not sheet_paths:
                raise ValueError("No HYPERMART or GOMART product sheets were found.")

            for sheet_name, sheet_path in sheet_paths.items():
                print(f"Indexing {sheet_name}...", flush=True)
                with archive.open(sheet_path) as source:
                    header_columns = None
                    sheet_rows = 0
                    for _, row_element in ET.iterparse(source, events=("end",)):
                        if row_element.tag != f"{{{MAIN_NS}}}row":
                            continue
                        cells = {
                            column_number(cell.attrib["r"]): cell_value(cell, strings)
                            for cell in row_element
                            if cell.tag == f"{{{MAIN_NS}}}c"
                        }
                        row_number = int(row_element.attrib.get("r", "0"))
                        if row_number == 1:
                            header_columns = {value.strip(): index for index, value in cells.items()}
                            missing = [name for name in REQUIRED_COLUMNS if name not in header_columns]
                            if missing:
                                raise ValueError(f"{sheet_name} is missing columns: {', '.join(missing)}")
                        elif header_columns:
                            fields = {
                                name: clean(cells.get(index, ""))
                                for name, index in header_columns.items()
                                if name in REQUIRED_COLUMNS
                            }
                            sku = fields["PRODUCT_CODE"]
                            if sku:
                                category = [
                                    fields["PROD_LEVEL2_DESC"],
                                    fields["PROD_LEVEL3_DESC"],
                                    fields["PROD_LEVEL4_DESC"],
                                ]
                                category = [value for value in category if value]
                                record = [
                                    sku,
                                    fields["UPC"],
                                    fields["PRODUCT_DESCRIPTION"],
                                    fields["PROD_LEVEL1_DESC"],
                                    category,
                                    fields["VENDOR_COMPANY_NAME"],
                                    sheet_name,
                                ]
                                if not description_only:
                                    write_shard_record(output_dir, record, writers, counts)
                                if description_output_dir:
                                    write_description_record(description_output_dir, record, description_writers, description_counts)
                                sheet_rows += 1
                                total += 1
                        row_element.clear()
                print(f"  {sheet_rows:,} products", flush=True)
    finally:
        for prefix, writer in writers.items():
            writer.write("]")
            writer.close()
        for prefix, writer in description_writers.items():
            writer.write("]")
            writer.close()

    if not description_only:
        print(f"Wrote {total:,} product rows across {len(counts)} shards to {output_dir}")
        for prefix, count in sorted(counts.items()):
            print(f"  {prefix}: {count:,}")
    if description_output_dir:
        print(f"Wrote {total:,} product rows across {len(description_counts)} description shards to {description_output_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", help="Path to the item-master .xlsx workbook")
    parser.add_argument("output", nargs="?", help="Directory where gzip JSON shards will be written")
    parser.add_argument("--description-output", help="Optional directory for description search shards")
    parser.add_argument("--description-only", action="store_true", help="Build only the description index")
    arguments = parser.parse_args()
    try:
        build(arguments.workbook, arguments.output, arguments.description_output, arguments.description_only)
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"Could not build master search index: {error}", file=sys.stderr)
        sys.exit(1)