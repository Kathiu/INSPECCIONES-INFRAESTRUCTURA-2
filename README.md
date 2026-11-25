# Inspecciones Infraestructura 2

Aplicación web progresiva para registrar inspecciones por área y punto, adjuntar hasta 12 fotografías, conservar registros localmente y sincronizarlos con Google Drive.

- **Aplicación:** https://kathiu.github.io/INSPECCIONES-INFRAESTRUCTURA-2/
- **Código de interfaz:** [app.js](app.js)
- **Backend de Google Apps Script:** [Code.gs](Code.gs)
- **Guía de instalación y publicación:** [GUIA_INSTALACION.txt](GUIA_INSTALACION.txt)

La aplicación usa un almacenamiento local independiente de la aplicación anterior. No borra ni transfiere automáticamente las inspecciones guardadas en el otro proyecto.

Antes de utilizarla para inspecciones reales, confirma una sincronización completa y comprueba que los registros y fotografías aparezcan en `INSPECCIONES_INFRAESTRUCTURA_2/INSPECCIONES_DIARIAS`. Los reportes PDF se guardan en `INSPECCIONES_INFRAESTRUCTURA_2/REPORTES_MENSUALES_2`.


## Formato del reporte PDF
El reporte mensual se genera en PDF con resumen ejecutivo, áreas en azul marino, puntos de inspección en azul acero y fotografías en bloques de hasta 2 columnas por 2 filas. Si un punto tiene más de cuatro fotografías, las restantes aparecen en bloques adicionales. Las imágenes se registran comprimidas desde la aplicación (máximo 1200 px y calidad JPEG 65%) para mantener legibilidad y controlar el tamaño del archivo.
