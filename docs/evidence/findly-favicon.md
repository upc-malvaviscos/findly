# Favicon de Findly

La shell estática (spec 03) incorpora la barra de la marca actual en terracota
`#d45c3d` sobre fondo `#f4f1eb`. `index.html` referencia un SVG escalable y un
ICO de respaldo con versiones de 16, 32 y 48 píxeles. Ambos se sirven desde
`public/`, sin fuentes, dependencias externas ni cambios de infraestructura.

`npm run build:web` terminó correctamente. Se comprobó que el HTML generado
referencia ambos iconos, que Vite copia los archivos sin modificaciones y que
el ICO contiene los tres tamaños. Se revisó visualmente la marca. Esta
evidencia acredita la compilación local; la publicación requiere el despliegue.
