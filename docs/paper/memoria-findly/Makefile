.PHONY: venv diagrams pdf docx clean

VENV := .venv
PYTHON ?= python3
PY := $(VENV)/bin/python3
PIP := $(VENV)/bin/pip
PANDOC ?= pandoc

venv:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -q -r requirements.txt

diagrams: venv
	$(PY) diagramas/arquitectura.py
	$(PY) diagramas/correo.py
	dot -Tpng diagramas/flujo.dot -o img/flujo.png
	$(PY) diagramas/portada.py
	$(PY) diagramas/portada_abstracta.py
	$(PY) -c "import cairosvg; cairosvg.svg2pdf(url='img/upc-logo.svg', write_to='img/upc-logo.pdf')"

pdf:
	$(PANDOC) memoria-postgrado.md -o memoria.pdf --fail-if-warnings --pdf-engine=xelatex \
		--filter pandoc-crossref --include-before-body=portada.tex

docx:
	pandoc memoria-postgrado.md -o memoria.docx \
		--filter pandoc-crossref --include-before-body=portada.tex

clean:
	rm -f memoria.pdf memoria.docx
