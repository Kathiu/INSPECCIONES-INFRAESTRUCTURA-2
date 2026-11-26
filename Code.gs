
/************************************************************
 * INSPECCIONES INFRAESTRUCTURA 2
 * Backend Google Apps Script
 * Versión 3.0
 *
 * Carpetas directamente en Mi unidad:
 * INSPECCIONES_DIARIAS
 * REPORTES_MENSUALES_2
 ************************************************************/

const INSPECTIONS_FOLDER_NAME = 'INSPECCIONES_DIARIAS';
const REPORTS_FOLDER_NAME = 'REPORTES_MENSUALES_2';
const LEGACY_ROOT_FOLDER_NAME = 'INSPECCIONES_INFRAESTRUCTURA_2';
const MAX_PHOTOS_PER_INSPECTION = 12;
const PHOTOS_PER_BLOCK = 10;

/* =========================================================
   1. GET
========================================================= */

function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p.action === 'check') {
    try {
      const id = String(p.id || '').trim();
      if (!id) throw new Error('Falta el ID de inspección.');

      const result = checkInspection_(id);
      return callbackOrJson_(result, p.prefix);
    } catch (err) {
      return callbackOrJson_({
        ok: false,
        error: errorMessage_(err)
      }, p.prefix);
    }
  }

  if (p.action === 'checkReport') {
    try {
      const year = safe_(p.anio || new Date().getFullYear());
      const month = safe_(p.mes || 'SIN_MES');
      const base = safe_(p.nombre || ('Reporte_' + year + '_' + month));
      const folder = getMonthReportFolder_(year, month);
      const files = folder.getFilesByName(base + '.pdf');

      let latest = null;
      while (files.hasNext()) {
        const f = files.next();
        if (!latest || f.getLastUpdated() > latest.getLastUpdated()) {
          latest = f;
        }
      }

      return callbackOrJson_(latest ? {
        ok: true,
        nombre: latest.getName(),
        id: latest.getId(),
        url: latest.getUrl()
      } : {
        ok: false,
        nombre: base
      }, p.prefix);
    } catch (err) {
      return callbackOrJson_({
        ok: false,
        error: errorMessage_(err)
      }, p.prefix);
    }
  }

  if (p.action === 'report') {
    return HtmlService.createHtmlOutput(
      buildReportHtml_(
        p.anio || new Date().getFullYear(),
        p.mes || 'SIN_MES'
      )
    ).setTitle('Reporte mensual de inspección');
  }

  if (p.action === 'generateReport') {
    try {
      const result = syncReport_({
        anio: p.anio,
        mes: p.mes,
        nombre: p.nombre
      });

      const data = JSON.parse(result.getContent());

      if (p.view === '1') {
        return HtmlService.createHtmlOutput(
          '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>body{font-family:Arial;padding:24px;max-width:560px;margin:auto;text-align:center}' +
          'a{display:block;padding:14px;margin:12px 0;background:#0b57d0;color:white;text-decoration:none;border-radius:8px}' +
          'small{color:#666;overflow-wrap:anywhere}</style></head><body>' +
          '<h2>Reporte mensual generado</h2>' +
          '<p>El PDF fue creado y guardado en Google Drive.</p>' +
          '<a href="' + escapeHtml_(data.downloadUrl) + '" target="_blank">Descargar PDF</a>' +
          '<a href="' + escapeHtml_(data.url) + '" target="_blank">Abrir PDF en Drive</a>' +
          '<a href="' + escapeHtml_(data.htmlUrl) + '" target="_blank">Abrir HTML</a>' +
          '<small>' + escapeHtml_(data.id) + '</small></body></html>'
        ).setTitle('Reporte mensual');
      }

      return callbackOrJson_(data, p.prefix);
    } catch (err) {
      const result = { ok: false, error: errorMessage_(err) };
      if (p.view === '1') {
        return HtmlService.createHtmlOutput(
          '<h3>No se pudo generar el reporte</h3><p>' +
          escapeHtml_(result.error) + '</p>'
        );
      }
      return callbackOrJson_(result, p.prefix);
    }
  }

  return json_({
    ok: true,
    service: 'INSPECCIONES_INFRAESTRUCTURA_2',
    version: '3.0',
    inspectionsFolder: INSPECTIONS_FOLDER_NAME,
    reportsFolder: REPORTS_FOLDER_NAME
  });
}

/* =========================================================
   2. POST
========================================================= */

function doPost(e) {
  try {
    const data = parsePostData_(e);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Los datos recibidos no son válidos.');
    }

    if (data.action === 'syncInspection') {
      return syncInspection_(data);
    }

    if (data.action === 'syncReport') {
      return syncReport_(data);
    }

    throw new Error('Acción no válida: ' + String(data.action || ''));
  } catch (err) {
    console.error('doPost: ' + errorMessage_(err));
    return json_({ ok: false, error: errorMessage_(err) });
  }
}

function parsePostData_(e) {
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }

  const raw = e && e.postData && e.postData.contents
    ? e.postData.contents : '';

  if (!raw) throw new Error('La solicitud POST llegó vacía.');

  try {
    return JSON.parse(raw);
  } catch (err) {
    const params = {};
    raw.split('&').forEach(function(part) {
      const i = part.indexOf('=');
      if (i < 0) return;
      const key = decodeURIComponent(part.slice(0, i).replace(/\+/g, ' '));
      const value = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
      params[key] = value;
    });
    if (!params.payload) throw new Error('No se encontró payload.');
    return JSON.parse(params.payload);
  }
}

/* =========================================================
   3. SINCRONIZAR INSPECCIÓN Y FOTOGRAFÍAS
========================================================= */

function syncInspection_(data) {
  if (!data.id) throw new Error('Falta el ID de inspección.');

  const photos = Array.isArray(data.fotos) ? data.fotos : [];
  if (photos.length > MAX_PHOTOS_PER_INSPECTION) {
    throw new Error('Máximo permitido: ' + MAX_PHOTOS_PER_INSPECTION + ' fotografías.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    // La carpeta ya existente está directamente en Mi unidad.
    const inspectionsRoot = getRootFolder_(INSPECTIONS_FOLDER_NAME);

    const date = new Date(data.fecha || new Date());
    if (isNaN(date.getTime())) throw new Error('Fecha de inspección no válida.');

    const year = safe_(data.anio || date.getFullYear());
    const month = safe_(data.mes || 'SIN_MES');
    const day = Utilities.formatDate(
      date, Session.getScriptTimeZone(), 'yyyy-MM-dd'
    );

    const yearFolder = getOrCreateFolder_(year, inspectionsRoot);
    const monthFolder = getOrCreateFolder_(month, yearFolder);
    const dayFolder = getOrCreateFolder_(day, monthFolder);

    const folderName = safe_(data.id) + '_' +
      safe_(data.zona || 'SIN_ZONA') + '_' +
      safe_(data.punto || 'SIN_PUNTO');

    const inspectionFolder = getOrCreateFolder_(folderName, dayFolder);
    const savedPhotos = [];

    photos.forEach(function(src, index) {
      if (typeof src !== 'string') {
        throw new Error('La fotografía ' + (index + 1) + ' no es válida.');
      }

      const match = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
      if (!match) {
        throw new Error('Formato no válido en fotografía ' + (index + 1) + '.');
      }

      const mime = match[1].toLowerCase();
      const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (allowed.indexOf(mime) < 0) {
        throw new Error('Formato no admitido: ' + mime);
      }

      const ext = mime === 'image/png' ? 'png' :
        mime === 'image/webp' ? 'webp' : 'jpg';

      const name = safe_(data.id) + '_foto_' + (index + 1) + '.' + ext;
      let file = firstFileByName_(inspectionFolder, name);

      if (!file) {
        const bytes = Utilities.base64Decode(match[2]);
        const blob = Utilities.newBlob(bytes, mime, name);
        file = inspectionFolder.createFile(blob);
      }

      savedPhotos.push({
        archivo: name,
        mimeType: file.getMimeType(),
        id: file.getId()
      });
    });

    // El JSON se guarda únicamente después de guardar todas las fotos.
    const metadata = Object.assign({}, data);
    metadata.fotos = savedPhotos;
    metadata.sincronizadoEn = new Date().toISOString();
    metadata.fotosAlmacenamiento = 'Google Drive';

    const jsonName = safe_(data.id) + '.json';
    const jsonText = JSON.stringify(metadata, null, 2);
    const existingJson = firstFileByName_(inspectionFolder, jsonName);

    if (existingJson) {
      existingJson.setContent(jsonText);
    } else {
      inspectionFolder.createFile(jsonName, jsonText, MimeType.PLAIN_TEXT);
    }

    return json_({
      ok: true,
      id: data.id,
      fotosEsperadas: photos.length,
      fotosGuardadas: savedPhotos.length,
      folder: inspectionFolder.getUrl()
    });
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
   4. VERIFICAR INSPECCIÓN Y FOTOGRAFÍAS
========================================================= */

function checkInspection_(id) {
  const name = safe_(id) + '.json';
  const folders = getInspectionRoots_();
  let jsonFile = null;

  folders.forEach(function(folder) {
    if (!jsonFile) jsonFile = findFileRecursive_(folder, name);
  });

  if (!jsonFile) {
    return {
      ok: false,
      id: id,
      fotosEsperadas: 0,
      fotosConfirmadas: 0
    };
  }

  const metadata = JSON.parse(jsonFile.getBlob().getDataAsString());
  const expected = Array.isArray(metadata.fotos) ? metadata.fotos : [];
  const parents = jsonFile.getParents();
  const parent = parents.hasNext() ? parents.next() : null;

  let confirmed = 0;
  if (parent) {
    expected.forEach(function(photo) {
      const fileName = typeof photo === 'string' ? photo : photo.archivo;
      if (fileName && firstFileByName_(parent, fileName)) confirmed++;
    });
  }

  return {
    ok: confirmed === expected.length,
    id: id,
    fotosEsperadas: expected.length,
    fotosConfirmadas: confirmed,
    checkedAt: new Date().toISOString()
  };
}

/* =========================================================
   5. GENERAR REPORTE PDF Y HTML
========================================================= */

function syncReport_(data) {
  const year = safe_(data.anio || new Date().getFullYear());
  const month = safe_(data.mes || 'SIN_MES');
  const base = safe_(data.nombre || ('Reporte_' + year + '_' + month));

  const html = buildReportHtml_(year, month);
  if (html.indexOf('No hay inspecciones sincronizadas') >= 0) {
    throw new Error('No hay inspecciones sincronizadas en Drive para ' + month + ' ' + year + '.');
  }

  let pdfBlob;
  try {
    pdfBlob = Utilities.newBlob(html, MimeType.HTML, base + '.html')
      .getAs(MimeType.PDF)
      .setName(base + '.pdf');
  } catch (err) {
    throw new Error('No se pudo convertir el reporte a PDF: ' + errorMessage_(err));
  }

  const folder = getMonthReportFolder_(year, month);

  // Se conservan los reportes anteriores; Drive admite nombres repetidos.
  const htmlFile = folder.createFile(base + '.html', html, MimeType.HTML);
  const pdfFile = folder.createFile(pdfBlob);

  return json_({
    ok: true,
    id: pdfFile.getId(),
    nombre: pdfFile.getName(),
    url: pdfFile.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' +
      encodeURIComponent(pdfFile.getId()),
    htmlUrl: htmlFile.getUrl(),
    bytes: pdfBlob.getBytes().length
  });
}

function getMonthReportFolder_(year, month) {
  const root = getRootFolder_(REPORTS_FOLDER_NAME);
  return getOrCreateFolder_(
    month,
    getOrCreateFolder_(year, root)
  );
}

/* =========================================================
   6. CONSTRUIR REPORTE MENSUAL
========================================================= */

function buildReportHtml_(year, month) {
  const rows = collectMonthInspections_(year, month);

  if (!rows.length) {
    return '<!doctype html><html><body><h2>No hay inspecciones sincronizadas en Drive para ' +
      escapeHtml_(month) + ' ' + escapeHtml_(year) + '.</h2></body></html>';
  }

  rows.sort(function(a, b) {
    const z = String(a.zona || '').localeCompare(String(b.zona || ''), 'es');
    if (z) return z;
    const p = String(a.punto || '').localeCompare(String(b.punto || ''), 'es');
    if (p) return p;
    return new Date(a.fecha || 0) - new Date(b.fecha || 0);
  });

  const zones = unique_(rows.map(x => x.zona || 'SIN_ZONA'));
  const points = unique_(rows.map(x => (x.zona || '') + '|' + (x.punto || '')));
  const incidence = rows.filter(x => String(x.resultado).toUpperCase() === 'CON INCIDENCIA').length;
  const pending = rows.filter(x => String(x.estado).toUpperCase() === 'PENDIENTE').length;
  const noInc = rows.filter(x => String(x.resultado).toUpperCase() === 'SIN INCIDENCIA').length;
  const photoCount = rows.reduce((n, x) => n + (x.photoData || []).length, 0);

  let html = '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Reporte mensual ' + escapeHtml_(month) + ' ' + escapeHtml_(year) + '</title>' +
    '<style>' + reportCss_() + '</style></head><body>' +
    '<header><h1>REPORTE MENSUAL DE INSPECCIÓN DE INFRAESTRUCTURA</h1>' +
    '<div class="periodo">MES: ' + escapeHtml_(month) + ' | AÑO: ' + escapeHtml_(year) + '</div>' +
    '<div class="small">Generado: ' + escapeHtml_(new Date().toLocaleString('es-PE')) + '</div></header>' +
    '<section class="summary">' +
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
    html += '<section class="inspection">' +
      '<div class="pointTitle">PUNTO DE INSPECCIÓN: ' +
      escapeHtml_(item.punto || 'SIN_PUNTO') + '</div>' +
      '<div class="itemInfo">' +
      '<div><b>Fecha:</b> ' + escapeHtml_(formatDate_(item.fecha)) + '</div>' +
      '<div><b>Resultado:</b> <span class="' +
      (String(item.resultado).toUpperCase() === 'CON INCIDENCIA' ? 'incidence' : 'noInc') +
      '">' + escapeHtml_(item.resultado || '') + '</span></div>' +
      (item.estado ? '<div><b>Estado:</b> ' + escapeHtml_(item.estado) + '</div>' : '') +
      '<div><b>Observación:</b> ' +
      escapeHtml_(item.observacion || 'Sin observación').replace(/\n/g, '<br>') + '</div>' +
      '<div><b>Fotografías:</b> ' + photos.length + '</div></div>';

    for (let i = 0; i < photos.length; i += PHOTOS_PER_BLOCK) {
      const block = photos.slice(i, i + PHOTOS_PER_BLOCK);
      html += '<div class="photoContinuation">' +
        (photos.length > PHOTOS_PER_BLOCK
          ? '<div class="continuationLabel">FOTOGRAFÍAS ' +
            (i + 1) + '–' + (i + block.length) + '</div>' : '') +
        photoGridHtml_(block, i) + '</div>';
    }

    html += '</section>';
  });

  return html + '<footer>Reporte mensual de inspección de infraestructura · ' +
    escapeHtml_(month) + ' ' + escapeHtml_(year) + '</footer></body></html>';
}

function summaryCell_(value, label) {
  return '<div class="summaryCell"><b>' + escapeHtml_(value) +
    '</b><span>' + escapeHtml_(label) + '</span></div>';
}

function photoGridHtml_(photos, start) {
  let html = '<div class="photoGrid">';
  photos.forEach(function(src, index) {
    html += '<div class="photoCell"><img src="' + src +
      '" alt="Fotografía ' + (start + index + 1) +
      '"><span>Foto ' + (start + index + 1) + '</span></div>';
  });
  return html + '</div>';
}

function reportCss_() {
  return '@page{size:A4;margin:9mm}' +
    'html,body{font-family:Arial,sans-serif;color:#243447;margin:0;font-size:8pt}' +
    'header{text-align:center;padding:4px 5px 8px;border-bottom:2px solid #142D4E}' +
    'h1{font-size:15pt;color:#142D4E;margin:0 0 5px}' +
    '.periodo{font-weight:bold;color:#34495e}.small{font-size:7pt;color:#687786}' +
    '.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin:7px 0}' +
    '.summaryCell{border:1px solid #aebbc7;background:#f5f7fa;padding:4px;text-align:center}' +
    '.summaryCell b{display:block;color:#142D4E;font-size:11pt}' +
    '.summaryCell span{font-size:6.5pt;text-transform:uppercase;color:#526575}' +
    '.areaTitle{background:#142D4E;color:white;padding:7px 9px;font-size:10pt;margin:9px 0 5px;break-after:avoid}' +
    '.inspection{border:1px solid #c4ccd4;margin-bottom:8px;break-inside:auto}' +
    '.pointTitle{background:#607D8B;color:white;padding:5px 8px;font-size:8.5pt;font-weight:bold}' +
    '.itemInfo{padding:6px 7px;line-height:1.35;font-size:7.5pt;overflow-wrap:anywhere}' +
    '.itemInfo div{margin-bottom:3px}.incidence{color:#b42318;font-weight:bold}' +
    '.noInc{color:#167044;font-weight:bold}' +
    '.photoContinuation{padding:4px;margin:0 5px 6px;background:#f1f4f7;border:1px solid #d4dbe2;break-inside:avoid}' +
    '.continuationLabel{font-size:6.5pt;font-weight:bold;color:#526575;margin-bottom:4px}' +
    '.photoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;break-inside:avoid}' +
    '.photoCell{height:2.45cm;position:relative;background:white;border:1px solid #d4dbe2;overflow:hidden;break-inside:avoid}' +
    '.photoCell img{width:100%;height:100%;object-fit:contain}' +
    '.photoCell span{position:absolute;right:3px;bottom:2px;background:#142D4E;color:white;padding:1px 3px;font-size:5.5pt}' +
    'footer{text-align:center;color:#82909c;font-size:6.5pt;border-top:1px solid #d8dee4;padding-top:4px;margin-top:8px}';
}

/* =========================================================
   7. LEER INSPECCIONES: NUEVAS Y LEGADAS
========================================================= */

function collectMonthInspections_(year, month) {
  const rows = [];
  const seen = {};

  // Ruta correcta: Mi unidad / INSPECCIONES_DIARIAS / año / mes.
  const daily = getRootFolder_(INSPECTIONS_FOLDER_NAME);
  const yf = daily.getFoldersByName(String(year));
  if (yf.hasNext()) {
    const mf = yf.next().getFoldersByName(String(month));
    if (mf.hasNext()) collectInspectionFiles_(mf.next(), rows, seen);
  }

  // Compatibilidad: ruta anterior ROOT / INSPECCIONES_DIARIAS / año / mes.
  const legacyRoot = firstFolderByName_(DriveApp.getRootFolder(), LEGACY_ROOT_FOLDER_NAME);
  if (legacyRoot) {
    const oldDaily = firstFolderByName_(legacyRoot, INSPECTIONS_FOLDER_NAME);
    if (oldDaily) {
      const oldYear = firstFolderByName_(oldDaily, String(year));
      const oldMonth = oldYear && firstFolderByName_(oldYear, String(month));
      if (oldMonth) collectInspectionFiles_(oldMonth, rows, seen);
    }

    // Otra ruta antigua: ROOT / año / mes.
    const oldYear2 = firstFolderByName_(legacyRoot, String(year));
    const oldMonth2 = oldYear2 && firstFolderByName_(oldYear2, String(month));
    if (oldMonth2) collectInspectionFiles_(oldMonth2, rows, seen);
  }

  return rows;
}

function collectInspectionFiles_(folder, rows, seen) {
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    if (!file.getName().toLowerCase().endsWith('.json')) continue;

    try {
      const item = JSON.parse(file.getBlob().getDataAsString());
      const id = String(item.id || file.getName());
      if (seen[id]) continue;
      seen[id] = true;

      item.photoData = [];
      const parents = file.getParents();
      const parent = parents.hasNext() ? parents.next() : folder;
      const photos = Array.isArray(item.fotos) ? item.fotos : [];

      photos.forEach(function(photo) {
        try {
          const name = typeof photo === 'string' ? photo : photo && photo.archivo;
          if (!name) return;

          const imageFile = firstFileByName_(parent, name);
          if (!imageFile) {
            console.warn('No se encontró fotografía: ' + name);
            return;
          }

          const blob = imageFile.getBlob();
          const mime = blob.getContentType() || 'image/jpeg';
          if (mime.indexOf('image/') !== 0) return;

          item.photoData.push(
            'data:' + mime + ';base64,' +
            Utilities.base64Encode(blob.getBytes())
          );
        } catch (err) {
          console.error('Error leyendo fotografía: ' + errorMessage_(err));
        }
      });

      rows.push(item);
    } catch (err) {
      console.error('Error leyendo ' + file.getName() + ': ' + errorMessage_(err));
    }
  }

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    collectInspectionFiles_(subfolders.next(), rows, seen);
  }
}

/* =========================================================
   8. UTILIDADES DE DRIVE
========================================================= */

function getRootFolder_(name) {
  return getOrCreateFolder_(name, DriveApp.getRootFolder());
}

function getOrCreateFolder_(name, parent) {
  const folder = parent || DriveApp.getRootFolder();
  const found = folder.getFoldersByName(name);
  return found.hasNext() ? found.next() : folder.createFolder(name);
}

function firstFolderByName_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : null;
}

function firstFileByName_(folder, name) {
  const files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function findFileRecursive_(folder, name) {
  const file = firstFileByName_(folder, name);
  if (file) return file;

  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const found = findFileRecursive_(subfolders.next(), name);
    if (found) return found;
  }
  return null;
}

function getInspectionRoots_() {
  const roots = [];
  const main = firstFolderByName_(DriveApp.getRootFolder(), INSPECTIONS_FOLDER_NAME);
  if (main) roots.push(main);

  const legacy = firstFolderByName_(DriveApp.getRootFolder(), LEGACY_ROOT_FOLDER_NAME);
  if (legacy) {
    const oldDaily = firstFolderByName_(legacy, INSPECTIONS_FOLDER_NAME);
    if (oldDaily) roots.push(oldDaily);
    roots.push(legacy);
  }
  return roots;
}

/* =========================================================
   9. UTILIDADES GENERALES
========================================================= */

function unique_(arr) {
  return Array.from(new Set(arr));
}

function formatDate_(value) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString('es-PE');
}

function escapeHtml_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#039;'
    }[m];
  });
}

function safe_(value) {
  return String(value == null ? '' : value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 120) || 'SIN_NOMBRE';
}

function errorMessage_(err) {
  return String(err && err.message ? err.message : err);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function callbackOrJson_(obj, prefix) {
  if (prefix && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(String(prefix))) {
    return ContentService.createTextOutput(
      prefix + '(' + JSON.stringify(obj) + ');'
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(obj);
}
