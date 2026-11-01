"""Print the text of PDF pages as JSON: {"<page>": "<text>", ...}.

Used by scripts/build-real-data.mjs to check that every figure it records really appears on the
page it cites. Run as `python3 -I scripts/pdf-page-text.py <file.pdf> <page> [<page> ...]` so the
download folder is never on Python's import path. Needs the pypdf package.
"""
import json
import sys

from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
out = {}
for arg in sys.argv[2:]:
    page = int(arg)
    try:
        out[str(page)] = reader.pages[page - 1].extract_text() or ''
    except Exception as exc:  # a damaged page should not stop the check of the others
        out[str(page)] = f'[could not read: {exc}]'
print(json.dumps(out))
