/************************************************************
 * INSPECCIONES INFRAESTRUCTURA 2
 * Backend para Google Apps Script
 * Servicio: INSPECCIONES_INFRAESTRUCTURA_2
 * Version: 2.1
 ************************************************************/

const ROOT_FOLDER_NAME = 'INSPECCIONES_INFRAESTRUCTURA_2';
const INSPECTIONS_FOLDER_NAME = 'INSPECCIONES_DIARIAS';
const REPORTS_FOLDER_NAME = 'REPORTES_MENSUALES_2';
const MAX_PHOTOS_PER_INSPECTION = 12;

/************************************************************
 * 1. GET: ESTADO, VERIFICACIÓN Y REPORTES
 ************************************************************/

function doGet(e) {
  const p = (e && e.parameter) || {};

  // Abrir el reporte HTML mensual.
  if (p.action === 'report') {
    return HtmlService.createHtmlOutput(
      buildReportHtml_(
        p.anio || new Date().getFullYear(),
        p.mes || 'SIN_MES'
      )
    ).setTitle('Reporte mensual de inspección');
  }

  // Generar PDF mensual.
  if (p.action === 'generateReport') {
    try {
      const result = syncReport_({
        anio: p.anio,
        mes: p.mes,
        nombre: p.nombre ||
          ('Reporte_' + p.anio + '_' + p.mes)
      });

      const data = JSON.parse(result.getContent());

      if (p.view === '1') {
        return HtmlService.createHtmlOutput(
          '<!doctype html><html lang="es">' +
          '<head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>' +
          'body{font-family:Arial,sans-serif;padding:24px;max-width:560px;margin:auto;text-align:center}' +
          'a{display:block;padding:14px;margin:12px 0;background:#0b57d0;color:white;text-decoration:none;border-radius:8px}' +
          'a.download{background:#16803a}' +
          'small{color:#666;overflow-wrap:anywhere}' +
          '</style></head><body>' +
          '<h2>Reporte mensual generado</h2>' +
          '<p>El PDF fue creado y guardado en Google Drive.</p>' +
          '<a class="download" href="' +
          escapeHtml_(data.downloadUrl) +
          '" target="_blank">Descargar PDF al celular</a>' +
          '<a href="' + escapeHtml_(data.url) +
          '" target="_blank">Abrir PDF en Drive</a>' +
          '<a href="' + escapeHtml_(data.htmlUrl) +
          '" target="_blank">Abrir HTML</a>' +
          '<small>' + escapeHtml_(data.id) +
          '</small></body></html>'
        ).setTitle('Reporte mensual');
      }

      return callbackOrJson_(data, p.prefix);

    } catch (err) {
      const obj = {
        ok: false,
        error: String(err && err.message ? err.message : err)
      };

      if (p.view === '1') {
        return HtmlService.createHtmlOutput(
          '<h3>No se pudo generar el reporte</h3><p>' +
          escapeHtml_(obj.error) + '</p>'
        );
      }

      return callbackOrJson_(obj, p.prefix);
    }
  }

  // Comprobar si una inspección está guardada en Drive.
  if (p.action === 'check') {
    try {
      const id = String(p.id || '').trim();

      if (!id) {
        throw new Error('Falta el ID para verificar.');
      }

      const found = fileExistsInFolderTree_(
        getOrCreateFolder_(ROOT_FOLDER_NAME),
        safe_(id) + '.json'
      );

      return callbackOrJson_({
        ok: found,
        id: id,
        checkedAt: new Date().toISOString()
      }, p.prefix);

    } catch (err) {
      return callbackOrJson_({
        ok: false,
        error: String(err && err.message ? err.message : err),
        id: String(p.id || '')
      }, p.prefix);
    }
  }

  // Verificar que el PDF mensual realmente exista en Drive.
  if (p.action === 'checkReport') {
    try {
      const year = safe_(p.anio || new Date().getFullYear());
      const month = safe_(p.mes || 'SIN_MES');
      const base = safe_(p.nombre || ('Reporte_' + year + '_' + month));
      const root = getOrCreateFolder_(ROOT_FOLDER_NAME);
      const reports = getOrCreateFolder_(REPORTS_FOLDER_NAME, root);
      const yearFolder = getOrCreateFolder_(year, reports);
      const monthFolder = getOrCreateFolder_(month, yearFolder);
      const files = monthFolder.getFilesByName(base + '.pdf');
      let result = { ok: false, nombre: base };
      if (files.hasNext()) {
        const file = files.next();
        result = { ok: true, nombre: base, url: file.getUrl(), id: file.getId() };
      }
      return callbackOrJson_(result, p.prefix);
    } catch (err) {
      return callbackOrJson_({ ok: false, error: String(err && err.message ? err.message : err) }, p.prefix);
    }
  }

  // Comprobación general del servicio.
  return json_({
    ok: true,
    service: 'INSPECCIONES_INFRAESTRUCTURA_2',
    version: '2.1'
  });
}

/************************************************************
 * 2. POST: RECIBIR DATOS DE LA APLICACIÓN
 ************************************************************/

function doPost(e) {
  try {
    const data = parsePostData_(e);

    if (!data || typeof data !== 'object' ||
        Array.isArray(data)) {
      throw new Error('Los datos recibidos no son válidos.');
    }

    if (!data.action) {
      throw new Error('Falta la acción solicitada.');
    }

    switch (String(data.action)) {
      case 'syncInspection':
        return syncInspection_(data);

      case 'syncReport':
        return syncReport_(data);

      default:
        throw new Error(
          'Acción no válida: ' + String(data.action)
        );
    }

  } catch (err) {
    console.error(
      'doPost: ' +
      String(err && err.stack ? err.stack : err)
    );

    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

/************************************************************
 * 3. INTERPRETAR LOS DATOS RECIBIDOS
 ************************************************************/

function parsePostData_(e) {
  // Formulario enviado con un campo llamado payload.
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }

  const raw = e && e.postData && e.postData.contents
    ? e.postData.contents
    : '';

  if (!raw) {
    throw new Error(
      'La solicitud POST llegó vacía. Revisa app.js.'
    );
  }

  // Intentar interpretar JSON directamente.
  try {
    return JSON.parse(raw);
  } catch (jsonError) {
    // Si no es JSON, intentar formulario URL-encoded.
    const params = {};

    raw.split('&').forEach(function(part) {
      const i = part.indexOf('=');

      if (i < 0) return;

      const key = decodeURIComponent(
        part.slice(0, i).replace(/\+/g, ' ')
      );

      const value = decodeURIComponent(
        part.slice(i + 1).replace(/\+/g, ' ')
      );

      params[key] = value;
    });

    if (!params.payload) {
      throw new Error(
        'No se encontró payload en la solicitud POST.'
      );
    }

    return JSON.parse(params.payload);
  }
}

/************************************************************
 * 4. GUARDAR INSPECCIÓN Y FOTOGRAFÍAS EN DRIVE
 ************************************************************/

function syncInspection_(data) {
  if (!data.id) {
    throw new Error('Falta el ID de inspección.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const root = getOrCreateFolder_(ROOT_FOLDER_NAME);
    const inspectionsRoot = getOrCreateFolder_(INSPECTIONS_FOLDER_NAME, root);
    const date = new Date(data.fecha || new Date());

    if (isNaN(date.getTime())) {
      throw new Error('La fecha de inspección no es válida.');
    }

    const year = String(
      data.anio || date.getFullYear()
    );

    const month = safe_(data.mes || 'SIN_MES');

    const day = Utilities.formatDate(
      date,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

    const zone = safe_(data.zona || 'SIN_ZONA');
    const point = safe_(data.punto || 'SIN_PUNTO');

    // Estructura: raíz / INSPECCIONES_DIARIAS / año / mes / día / inspección.
    const yearFolder = getOrCreateFolder_(year, inspectionsRoot);
    const monthFolder = getOrCreateFolder_(month, yearFolder);
    const dayFolder = getOrCreateFolder_(day, monthFolder);

    const inspectionFolder = getOrCreateFolder_(
      safe_(data.id) + '_' + zone + '_' + point,
      dayFolder
    );

    const photos = Array.isArray(data.fotos)
      ? data.fotos
      : [];

    if (photos.length > MAX_PHOTOS_PER_INSPECTION) {
      throw new Error(
        'El máximo permitido es ' +
        MAX_PHOTOS_PER_INSPECTION + ' fotografías.'
      );
    }

    const photoFiles = [];
    const photoErrors = [];

    photos.forEach(function(src, i) {
      try {
        // Aceptar imágenes en formato data URL.
        if (typeof src !== 'string') {
          throw new Error(
            'La fotografía no está en formato de texto.'
          );
        }

        const match = src.match(
          /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
        );

        if (!match) {
          throw new Error(
            'Formato de fotografía no válido.'
          );
        }

        const mimeType = match[1].toLowerCase();

        const allowed = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp'
        ];

        if (allowed.indexOf(mimeType) < 0) {
          throw new Error(
            'Formato no admitido: ' + mimeType
          );
        }

        const extension = mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/webp'
            ? 'webp'
            : 'jpg';

        const fileName =
          safe_(data.id) + '_foto_' + (i + 1) +
          '.' + extension;

        // Reutilizar la foto si ya se guardó anteriormente.
        const existing =
          inspectionFolder.getFilesByName(fileName);

        if (existing.hasNext()) {
          photoFiles.push({
            archivo: fileName,
            mimeType: mimeType
          });
          return;
        }

        const bytes = Utilities.base64Decode(match[2]);

        const blob = Utilities.newBlob(
          bytes,
          mimeType,
          fileName
        );

        inspectionFolder.createFile(blob);

        photoFiles.push({
          archivo: fileName,
          mimeType: mimeType
        });

      } catch (photoError) {
        photoErrors.push({
          foto: i + 1,
          error: String(
            photoError && photoError.message
              ? photoError.message
              : photoError
          )
        });
      }
    });

    if (photoErrors.length > 0) {
      throw new Error(
        'No se completó el guardado de todas las fotografías. ' +
        'Se guardaron ' + photoFiles.length + ' de ' + photos.length +
        '. Vuelva a sincronizar para reintentar. Detalle: ' +
        JSON.stringify(photoErrors)
      );
    }

    // Guardar los datos de la inspección.
    const metadata = Object.assign({}, data);

    metadata.fotos = photoFiles;
    metadata.sincronizadoEn = new Date().toISOString();
    metadata.fotosAlmacenamiento = 'Google Drive';

    if (photoErrors.length > 0) {
      metadata.erroresFotos = photoErrors;
    } else {
      delete metadata.erroresFotos;
    }

    const jsonName = safe_(data.id) + '.json';
    const jsonText = JSON.stringify(metadata, null, 2);
    const existingJson =
      inspectionFolder.getFilesByName(jsonName);

    if (existingJson.hasNext()) {
      existingJson.next().setContent(jsonText);
    } else {
      inspectionFolder.createFile(
        jsonName,
        jsonText,
        MimeType.PLAIN_TEXT
      );
    }

    return json_({
      ok: true,
      id: data.id,
      folder: inspectionFolder.getUrl(),
      fotos: photoFiles.length,
      erroresFotos: photoErrors
    });

  } finally {
    lock.releaseLock();
  }
}

/************************************************************
 * 5. GENERAR REPORTE MENSUAL EN HTML Y PDF
 ************************************************************/

function syncReport_(data) {
  const year = safe_(
    data.anio || new Date().getFullYear()
  );

  const month = safe_(data.mes || 'SIN_MES');

  const base = safe_(
    data.nombre || ('Reporte_' + year + '_' + month)
  );

  const html = buildReportHtml_(year, month);

  if (!html || html.indexOf('No hay inspecciones') >= 0) {
    throw new Error(
      'No hay inspecciones sincronizadas en Drive para ' +
      month + ' ' + year + '.'
    );
  }

  let pdfBlob;

  try {
    const htmlBlob = Utilities.newBlob(
      html,
      MimeType.HTML,
      base + '.html'
    );

    pdfBlob = htmlBlob.getAs(MimeType.PDF);
    pdfBlob.setName(base + '.pdf');

  } catch (err) {
    throw new Error(
      'No se pudo convertir el reporte a PDF. ' +
      'Puede ser demasiado grande. Detalle: ' +
      String(err && err.message ? err.message : err)
    );
  }

  const root = getOrCreateFolder_(ROOT_FOLDER_NAME);
  const reports = getOrCreateFolder_(
    REPORTS_FOLDER_NAME,
    root
  );
  const yearFolder = getOrCreateFolder_(year, reports);
  const monthFolder = getOrCreateFolder_(month, yearFolder);

  // Crear primero los archivos nuevos.
  const htmlFile = monthFolder.createFile(
    base + '.html',
    html,
    MimeType.HTML
  );

  let pdfFile;

  try {
    pdfFile = monthFolder.createFile(pdfBlob);
  } catch (err) {
    htmlFile.setTrashed(true);
    throw new Error(
      'No se pudo guardar el PDF en Drive: ' +
      String(err && err.message ? err.message : err)
    );
  }

  // Eliminar versiones anteriores solo si el PDF se guardó.
  ['.pdf', '.html'].forEach(function(ext) {
    const oldFiles = monthFolder.getFilesByName(base + ext);

    while (oldFiles.hasNext()) {
      const oldFile = oldFiles.next();

      if (oldFile.getId() !== pdfFile.getId() &&
          oldFile.getId() !== htmlFile.getId()) {
        oldFile.setTrashed(true);
      }
    }
  });

  return json_({
    ok: true,
    id: pdfFile.getName(),
    url: pdfFile.getUrl(),
    downloadUrl:
      'https://drive.google.com/uc?export=download&id=' +
      encodeURIComponent(pdfFile.getId()),
    htmlUrl: htmlFile.getUrl(),
    bytes: pdfBlob.getBytes().length
  });
}

/************************************************************
 * 6. CONSTRUIR EL CONTENIDO DEL REPORTE
 ************************************************************/

function buildReportHtml_(year, month) {
  const rows = collectMonthInspections_(year, month);

  if (!rows.length) {
    return '<!doctype html><html lang="es"><body><h2>No hay inspecciones sincronizadas en Drive para ' +
      escapeHtml_(month) + ' ' + escapeHtml_(year) + '.</h2></body></html>';
  }

  // Orden estable: área, punto y fecha.
  rows.sort(function(a, b) {
    const zoneCompare = String(a.zona || '').localeCompare(String(b.zona || ''), 'es');
    if (zoneCompare !== 0) return zoneCompare;
    const pointCompare = String(a.punto || '').localeCompare(String(b.punto || ''), 'es');
    if (pointCompare !== 0) return pointCompare;
    return new Date(a.fecha || 0).getTime() - new Date(b.fecha || 0).getTime();
  });

  const zones = unique_(rows.map(function(x) { return x.zona || 'SIN_ZONA'; }));
  const points = unique_(rows.map(function(x) { return (x.zona || '') + '|' + (x.punto || ''); }));
  const incidence = rows.filter(function(x) { return String(x.resultado || '').toUpperCase() === 'CON INCIDENCIA'; }).length;
  const pending = rows.filter(function(x) { return String(x.estado || '').toUpperCase() === 'PENDIENTE'; }).length;
  const noInc = rows.filter(function(x) { return String(x.resultado || '').toUpperCase() === 'SIN INCIDENCIA'; }).length;
  const photoCount = rows.reduce(function(total, x) { return total + (x.photoData || []).length; }, 0);

  let html = '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Reporte mensual ' + escapeHtml_(month) + ' ' + escapeHtml_(year) + '</title>' +
    '<style>' + reportCss_() + '</style></head><body>' +
    '<header><h1>REPORTE MENSUAL DE INSPECCIÓN DE INFRAESTRUCTURA</h1>' +
    '<div class="periodo">MES: ' + escapeHtml_(month) + ' &nbsp; | &nbsp; AÑO: ' + escapeHtml_(year) + '</div>' +
    '<div class="small">Generado: ' + escapeHtml_(new Date().toLocaleString('es-PE')) + '</div></header>' +
    '<main><section class="summary">' +
    summaryCell_(rows.length, 'Inspecciones') +
    summaryCell_(zones.length, 'Áreas') +
    summaryCell_(points.length, 'Puntos') +
    summaryCell_(incidence, 'Incidencias') +
    summaryCell_(pending, 'Pendientes') +
    summaryCell_(noInc, 'Sin incidencia') +
    summaryCell_(photoCount, 'Fotografías') +
    summaryCell_(rows.length, 'Registros en Drive') +
    '</section>';

  let lastZone = '';
  rows.forEach(function(item) {
    const zone = item.zona || 'SIN_ZONA';
    if (zone !== lastZone) {
      html += '<h2 class="areaTitle">ÁREA / ZONA: ' + escapeHtml_(zone) + '</h2>';
      lastZone = zone;
    }

    const photos = item.photoData || [];
    const info = '<div class="itemInfo">' +
      '<div class="data"><b>Fecha:</b> ' + escapeHtml_(formatDate_(item.fecha)) + '</div>' +
      '<div class="data"><b>Resultado:</b> <span class="' +
      (String(item.resultado || '').toUpperCase() === 'CON INCIDENCIA' ? 'incidence' : 'noInc') + '">' +
      escapeHtml_(item.resultado || '') + '</span></div>' +
      (item.estado ? '<div class="data"><b>Estado:</b> <span class="' +
        (String(item.estado).toUpperCase() === 'PENDIENTE' ? 'pending' : 'reported') + '">' +
        escapeHtml_(item.estado) + '</span></div>' : '') +
      '<div class="data observation"><b>Observación:</b> ' +
      escapeHtml_(item.observacion || 'Sin observación').replace(/\n/g, '<br>') + '</div>' +
      '<div class="photoLabel"><b>Fotografías:</b> ' + photos.length + '</div></div>';

    html += '<section class="inspection">' +
      '<div class="pointTitle">PUNTO DE INSPECCIÓN: ' +
      escapeHtml_(item.punto || 'SIN_PUNTO') + '</div>';

    if (!photos.length) {
      html += '<div class="inspectionBody noPhotos">' + info + '</div>';
    } else {
      html += '<div class="inspectionBody">' + info +
        '<div class="photoPanel">' + photoGridHtml_(photos, 0) + '</div></div>';
      // Máximo cuatro fotografías por bloque (2 columnas x 2 filas).
      // Si hay más, se muestran en bloques adicionales compactos sin perder ninguna.
      for (let i = 4; i < photos.length; i += 4) {
        html += '<div class="photoContinuation"><div class="continuationLabel">FOTOGRAFÍAS ADICIONALES · ' +
          (i + 1) + '–' + Math.min(i + 4, photos.length) + '</div>' +
          photoGridHtml_(photos, i) + '</div>';
      }
    }
    html += '</section>';
  });

  return html + '</main><footer>Reporte mensual de inspección de infraestructura · ' +
    escapeHtml_(month) + ' ' + escapeHtml_(year) + '</footer></body></html>';
}

function summaryCell_(value, label) {
  return '<div class="summaryCell"><b>' + escapeHtml_(value) +
    '</b><span>' + escapeHtml_(label) + '</span></div>';
}

/************************************************************
 * 7. FOTOGRAFÍAS: BLOQUES DE 2 COLUMNAS X 2 FILAS
 ************************************************************/

function photoGridHtml_(photos, start) {
  let html = '<div class="photoGrid">';
  const end = Math.min(start + 4, photos.length);
  for (let i = start; i < end; i++) {
    html += '<div class="photoCell"><img src="' + photos[i] +
      '" alt="Fotografía ' + (i + 1) + '"><span>Foto ' + (i + 1) + '</span></div>';
  }
  return html + '</div>';
}

/************************************************************
 * 8. DISEÑO DEL REPORTE PDF
 ************************************************************/

function reportCss_() {
  return '@page{size:A4;margin:9mm 9mm 10mm}' +
    'html,body{font-family:Arial,Helvetica,sans-serif;color:#243447;margin:0;padding:0;font-size:8.5pt}' +
    'header{text-align:center;padding:3px 8px 8px;border-bottom:2px solid #142D4E;margin-bottom:7px}' +
    'h1{font-size:15pt;letter-spacing:.2px;color:#142D4E;margin:0 0 4px;font-weight:700}' +
    '.periodo{font-size:9pt;font-weight:bold;color:#34495e;margin-bottom:2px}' +
    '.small{font-size:7pt;color:#687786}' +
    'main{padding:0}' +
    '.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin:6px 0 9px}' +
    '.summaryCell{border:1px solid #aebbc7;padding:4px 3px;text-align:center;background:#f5f7fa}' +
    '.summaryCell b{display:block;font-size:11pt;color:#142D4E;line-height:1.15}' +
    '.summaryCell span{display:block;font-size:6.8pt;text-transform:uppercase;color:#526575;margin-top:2px}' +
    '.areaTitle{font-size:10pt;line-height:1.25;color:#fff;background:#142D4E;padding:7px 9px;margin:9px 0 5px;page-break-after:avoid;break-after:avoid;border-radius:2px}' +
    '.inspection{border:1px solid #c4ccd4;margin:0 0 7px;page-break-inside:auto;break-inside:auto}' +
    '.pointTitle{background:#607D8B;color:#fff;font-size:8.7pt;font-weight:bold;padding:5px 8px;line-height:1.2;page-break-after:avoid;break-after:avoid}' +
    '.inspectionBody{display:grid;grid-template-columns:5.4cm 1fr;gap:5px;padding:5px;align-items:start}' +
    '.inspectionBody.noPhotos{grid-template-columns:1fr}' +
    '.itemInfo{min-width:0;padding:1px 3px}' +
    '.data{font-size:7.5pt;margin:0 0 3px;line-height:1.28;overflow-wrap:anywhere}' +
    '.observation{white-space:normal}' +
    '.incidence{color:#b42318;font-weight:bold}.noInc{color:#167044;font-weight:bold}' +
    '.pending{color:#a15c00;font-weight:bold}.reported{color:#167044;font-weight:bold}' +
    '.photoLabel{font-size:7.2pt;margin-top:4px;color:#526575}' +
    '.photoPanel{min-width:0;background:#f1f4f7;padding:4px}' +
    '.photoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;page-break-inside:avoid;break-inside:avoid}' +
    '.photoCell{position:relative;min-width:0;height:3.45cm;background:#fff;border:1px solid #d4dbe2;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
    '.photoCell img{display:block;width:100%;height:100%;object-fit:contain}' +
    '.photoCell span{position:absolute;right:3px;bottom:2px;background:rgba(20,45,78,.78);color:#fff;font-size:5.5pt;padding:1px 3px}' +
    '.photoContinuation{margin:0 5px 6px 5px;padding:4px;background:#f1f4f7;border:1px solid #d4dbe2;page-break-inside:avoid;break-inside:avoid}' +
    '.continuationLabel{font-size:6.5pt;color:#526575;font-weight:bold;margin:0 0 3px}' +
    'footer{font-size:6.5pt;color:#82909c;text-align:center;border-top:1px solid #d8dee4;margin-top:8px;padding-top:4px}' +
    '@media print{.inspection,.photoContinuation{orphans:2;widows:2}.photoGrid{page-break-inside:avoid;break-inside:avoid}}';
}

/************************************************************
 * 9. LEER INSPECCIONES Y FOTOGRAFÍAS DESDE DRIVE
 ************************************************************/

function collectMonthInspections_(year, month) {
  const root = getOrCreateFolder_(ROOT_FOLDER_NAME);
  const rows = [];

  // Estructura nueva: raíz / INSPECCIONES_DIARIAS / año / mes.
  const dailyFolders = root.getFoldersByName(INSPECTIONS_FOLDER_NAME);
  if (dailyFolders.hasNext()) {
    const dailyYearFolders = dailyFolders.next().getFoldersByName(String(year));
    if (dailyYearFolders.hasNext()) {
      const dailyMonthFolders = dailyYearFolders.next().getFoldersByName(String(month));
      if (dailyMonthFolders.hasNext()) collectInspectionFiles_(dailyMonthFolders.next(), rows);
    }
  }

  // Compatibilidad con inspecciones anteriores guardadas directamente en raíz / año / mes.
  const legacyYearFolders = root.getFoldersByName(String(year));
  if (legacyYearFolders.hasNext()) {
    const legacyMonthFolders = legacyYearFolders.next().getFoldersByName(String(month));
    if (legacyMonthFolders.hasNext()) collectInspectionFiles_(legacyMonthFolders.next(), rows);
  }

  return rows;
}

function collectInspectionFiles_(folder, rows) {
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();

    if (!file.getName().toLowerCase().endsWith('.json')) {
      continue;
    }

    try {
      const item = JSON.parse(
        file.getBlob().getDataAsString()
      );

      item.photoData = [];

      const parents = file.getParents();
      const parent = parents.hasNext()
        ? parents.next()
        : folder;

      const photos = Array.isArray(item.fotos)
        ? item.fotos
        : [];

      photos.forEach(function(photo) {
        try {
          const name = typeof photo === 'string'
            ? photo
            : photo && photo.archivo;

          if (!name) return;

          const photoFiles = parent.getFilesByName(name);

          if (!photoFiles.hasNext()) {
            console.warn('No se encontró la foto: ' + name);
            return;
          }

          const photoFile = photoFiles.next();
          const blob = photoFile.getBlob();
          const mimeType =
            blob.getContentType() || 'image/jpeg';

          if (mimeType.indexOf('image/') !== 0) {
            return;
          }

          const base64 = Utilities.base64Encode(
            blob.getBytes()
          );

          item.photoData.push(
            'data:' + mimeType + ';base64,' + base64
          );

        } catch (photoError) {
          console.error(
            'Error leyendo fotografía: ' +
            String(
              photoError && photoError.message
                ? photoError.message
                : photoError
            )
          );
        }
      });

      rows.push(item);

    } catch (err) {
      console.error(
        'Error leyendo ' + file.getName() + ': ' + err
      );
    }
  }

  // Buscar también dentro de las carpetas de inspección.
  const subfolders = folder.getFolders();

  while (subfolders.hasNext()) {
    collectInspectionFiles_(subfolders.next(), rows);
  }
}

/************************************************************
 * 10. FUNCIONES AUXILIARES
 ************************************************************/

function fileExistsInFolderTree_(folder, fileName) {
  // Buscar por nombre en Drive evita recorrer una por una todas
  // las carpetas de años, meses, días e inspecciones.
  // El ID INS-... es único y el archivo JSON solo se crea al
  // finalizar el guardado de las fotografías.
  const safeName = String(fileName || '').replace(/'/g, "\\'");
  const matches = DriveApp.searchFiles(
    "title = '" + safeName + "' and trashed = false"
  );

  while (matches.hasNext()) {
    const file = matches.next();
    if (file.getName() === fileName) return true;
  }

  return false;
}

function unique_(arr) {
  return Array.from(new Set(arr));
}

function formatDate_(value) {
  if (!value) return '';

  try {
    return new Date(value).toLocaleString('es-PE');
  } catch (err) {
    return String(value);
  }
}

function escapeHtml_(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    function(m) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[m];
    }
  );
}

function safe_(value) {
  return String(value == null ? '' : value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 120) || 'SIN_NOMBRE';
}

function getOrCreateFolder_(name, parent) {
  const folder = parent || DriveApp.getRootFolder();
  const folders = folder.getFoldersByName(name);

  return folders.hasNext()
    ? folders.next()
    : folder.createFolder(name);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function callbackOrJson_(obj, prefix) {
  if (
    prefix &&
    /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(String(prefix))
  ) {
    return ContentService.createTextOutput(
      prefix + '(' + JSON.stringify(obj) + ');'
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return json_(obj);
}
