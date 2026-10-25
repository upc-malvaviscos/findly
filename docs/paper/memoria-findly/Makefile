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
	dot -Tpng diagramas/arquitectura.dot -o img/arquitectura.png
	$(PY) diagramas/secuencia-matching.py
	$(PY) diagramas/correo.py
	dot -Tpng diagramas/flujo.dot -o img/flujo.png
	dot -Tpng diagramas/contexto-c4.dot -o img/contexto-c4.png
	dot -Tpng diagramas/contenedores-c4.dot -o img/contenedores-c4.png
	dot -Tpng diagramas/despliegue.dot -o img/despliegue.png
	dot -Tpng diagramas/workflow-pr.dot -o img/workflow-pr.png
	dot -Tpng diagramas/workflow-deploy.dot -o img/workflow-deploy.png
	dot -Tpng diagramas/workflow-pdf.dot -o img/workflow-pdf.png
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
