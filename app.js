
/************************************************************
 * INSPECCIONES INFRAESTRUCTURA 2
 * Frontend
 * Conserva IndexedDB existente
 ************************************************************/

let C, db, photos = [], syncing = false;

const $ = id => document.getElementById(id);
const DB_NAME = 'inspecciones-infraestructura-2';
const DB_VERSION = 1;
const STORE_NAME = 'inspecciones';
const DRIVE_KEY = 'inspecciones_drive_url_v2_repo';

const DEFAULT_DRIVE_URL =
  'https://script.google.com/a/macros/aliexperu.com.pe/s/AKfycby0D5sphuxMTUVH3WTLt6-jbiTMUwTUpsJAZhODWdz09fdTg7i0ctqP3MojYRr8zgTD/exec';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
  '"': '&quot;', "'": '&#039;'
}[m]));

/* =========================================================
   1. BASE DE DATOS LOCAL
========================================================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

function os(mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function all() {
  return new Promise((resolve, reject) => {
    const request = os('readonly').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function put(record) {
  return new Promise((resolve, reject) => {
    const request = os('readwrite').put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function del(id) {
  return new Promise((resolve, reject) => {
    const request = os('readwrite').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/* =========================================================
   2. FOTOGRAFÍAS
========================================================= */

async function compress(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1200;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear el lienzo.');

    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();

    const output = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.65)
    );

    if (!output) throw new Error('No se pudo comprimir la fotografía.');
    return output;
  } catch (error) {
    console.warn('Se conservará la fotografía original:', error);
    return file;
  }
}

function renderPhotos() {
  $('photoCount').textContent = `${photos.length}/12`;
  $('photos').innerHTML = photos.map((photo, index) =>
    `<div class="photo">
      <img src="${photo}" alt="Fotografía ${index + 1}">
      <button type="button" data-remove-photo="${index}">×</button>
    </div>`
  ).join('');

  $('photos').querySelectorAll('[data-remove-photo]').forEach(button => {
    button.onclick = () => {
      photos.splice(Number(button.dataset.removePhoto), 1);
      renderPhotos();
    };
  });
}

/* =========================================================
   3. FORMULARIO
========================================================= */

function points() {
  const zone = C.zones.find(x => x.name === $('zone').value);
  $('point').disabled = !zone;

  $('point').innerHTML =
    '<option value="">Seleccione un punto</option>' +
    (zone ? zone.points.map(p =>
      `<option value="${esc(p)}">${esc(p)}</option>`
    ).join('') : '');
}

function reset() {
  $('zone').value = '';
  points();
  $('obs').value = '';
  $('result').value = 'SIN INCIDENCIA';
  $('status').value = 'REPORTADO';
  photos = [];
  renderPhotos();
}

/* =========================================================
   4. GOOGLE DRIVE
========================================================= */

function driveUrl() {
  return (localStorage.getItem(DRIVE_KEY) || DEFAULT_DRIVE_URL).trim();
}

function updateDriveStatus() {
  $('driveStatus').textContent =
    'Drive: configurado. Las fotografías también se conservan en el teléfono.';
}

function jsonp(url, timeoutMs = 10000) {
  return new Promise(resolve => {
    const callback =
      'driveCallback_' + Date.now() + '_' +
      Math.random().toString(36).slice(2);

    const script = document.createElement('script');
    let finished = false;

    const done = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      delete window[callback];
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(result || null);
    };

    const timer = setTimeout(() => done(null), timeoutMs);

    window[callback] = done;
    script.onerror = () => done(null);
    script.src = url + (url.includes('?') ? '&' : '?') +
      'prefix=' + encodeURIComponent(callback) +
      '&t=' + Date.now();

    document.body.appendChild(script);
  });
}

async function verifySync(id) {
  const url = driveUrl() +
    '?action=check&id=' + encodeURIComponent(id);

  return await jsonp(url, 10000);
}

function postInspection(url, record) {
  return new Promise((resolve, reject) => {
    const target = 'drive_post_' + Date.now() + '_' +
      Math.random().toString(36).slice(2);

    const frame = document.createElement('iframe');
    frame.name = target;
    frame.style.display = 'none';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = target;
    form.enctype = 'application/x-www-form-urlencoded';
    form.style.display = 'none';

    const field = document.createElement('textarea');
    field.name = 'payload';
    field.value = JSON.stringify({
      action: 'syncInspection',
      ...record
    });

    form.appendChild(field);

    let finished = false;

    const cleanup = () => {
      if (form.parentNode) form.parentNode.removeChild(form);
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    };

    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      resolve(result);
    };

    // El envío por iframe no permite leer la respuesta entre dominios.
    // La confirmación real se hace posteriormente mediante check.
    const timer = setTimeout(() => finish(true), 12000);

    frame.onload = () => {
      if (frame.dataset.loaded === '1') {
        finish(true);
      } else {
        frame.dataset.loaded = '1';
      }
    };

    document.body.appendChild(frame);
    document.body.appendChild(form);

    try {
      form.submit();
    } catch (error) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        cleanup();
        reject(error);
      }
    }
  });
}

/* =========================================================
   5. SINCRONIZAR UNA INSPECCIÓN
========================================================= */

async function syncOne(record) {
  const url = driveUrl();

  if (!url || !navigator.onLine) {
    record.sync = 'PENDIENTE';
    await put(record);
    await show();
    return false;
  }

  try {
    await postInspection(url, record);

    const expectedPhotos = (record.fotos || []).length;

    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1500));

      const result = await verifySync(record.id);

      if (
        result &&
        result.ok === true &&
        Number(result.fotosConfirmadas) === expectedPhotos &&
        Number(result.fotosEsperadas) === expectedPhotos
      ) {
        record.sync = 'SINCRONIZADO';
        record.syncAt = new Date().toISOString();
        record.fotosEnDrive = true;

        // No se eliminan ni se reemplazan las fotos locales.
        await put(record);
        await show();
        return true;
      }
    }

    throw new Error(
      'Drive no confirmó todas las fotografías. ' +
      'La inspección permanecerá pendiente para volver a intentarlo.'
    );

  } catch (error) {
    console.error('Error sincronizando inspección:', error);

    record.sync = 'PENDIENTE';
    record.fotosEnDrive = false;

    await put(record);
    await show();
    return false;
  }
}

/* =========================================================
   6. SINCRONIZAR PENDIENTES
========================================================= */

async function syncPending(silent = false) {
  if (syncing) return false;

  if (!driveUrl() || !navigator.onLine) {
    if (!silent) {
      alert(
        'No hay conexión a Internet o falta configurar Google Drive. ' +
        'Las inspecciones siguen guardadas en el teléfono.'
      );
    }
    return false;
  }

  syncing = true;
  const button = $('syncNow');

  if (button && !silent) {
    button.disabled = true;
    button.textContent = 'Preparando sincronización…';
  }

  try {
    const records = await all();
    const pending = records.filter(x => x.sync !== 'SINCRONIZADO');
    let confirmed = 0;

    for (let i = 0; i < pending.length; i++) {
      if (!navigator.onLine) break;

      if (button && !silent) {
        button.textContent =
          'Sincronizando ' + (i + 1) + '/' + pending.length + '…';
      }

      if (await syncOne(pending[i])) confirmed++;
    }

    await show();

    if (!silent) {
      if (!pending.length) {
        alert('No hay inspecciones pendientes de sincronización.');
      } else if (confirmed === pending.length) {
        alert('Correcto: se confirmaron ' + confirmed +
          ' inspecciones y sus fotografías en Google Drive.');
      } else {
        alert(
          'Se confirmaron ' + confirmed + ' de ' + pending.length +
          ' inspecciones. Las restantes siguen guardadas en el teléfono.'
        );
      }
    }

    return confirmed > 0;

  } catch (error) {
    console.error(error);
    if (!silent) {
      alert('La sincronización se interrumpió. Los datos siguen guardados localmente.');
    }
    return false;

  } finally {
    syncing = false;
    if (button && !silent) {
      button.disabled = false;
      button.textContent = 'Sincronizar pendientes';
    }
  }
}

/* =========================================================
   7. CONECTAR DRIVE
========================================================= */

$('connectDrive').onclick = () => {
  const current = driveUrl();

  const value = prompt(
    'Pegue la URL de la aplicación web de Apps Script.\n' +
    'Debe terminar en /exec. No introduzca contraseñas.',
    current
  );

  if (!value) return;

  const url = value.trim();

  if (!/^https:\/\/script\.google\.com\/(?:macros\/s\/[^\s/]+|a\/macros\/[^\s/]+\/s\/[^\s/]+)\/exec$/.test(url)) {
    alert('La URL no tiene un formato reconocido. Use la URL /exec de Apps Script.');
    return;
  }

  localStorage.setItem(DRIVE_KEY, url);
  updateDriveStatus();

  alert('Google Drive quedó configurado.');
};

$('syncNow').onclick = () => syncPending(false);

/* =========================================================
   8. EVENTOS DEL FORMULARIO
========================================================= */

$('zone').onchange = points;

$('camera').onclick = () => {
  if (photos.length >= 12) {
    alert('Máximo 12 fotografías por punto.');
    return;
  }
  $('cameraInput').click();
};

$('cameraInput').onchange = async event => {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';

  if (!file) return;

  if (photos.length >= 12) {
    alert('Máximo 12 fotografías por punto.');
    return;
  }

  try {
    const compressed = await compress(file);
    const reader = new FileReader();

    reader.onload = () => {
      if (photos.length >= 12) return;
      photos.push(reader.result);
      renderPhotos();
    };

    reader.onerror = () => alert('No se pudo leer la fotografía.');
    reader.readAsDataURL(compressed);

  } catch (error) {
    console.error(error);
    alert('No se pudo procesar la fotografía.');
  }
};

$('clear').onclick = () => {
  if (confirm('¿Borrar el formulario actual?')) reset();
};

/* =========================================================
   9. GUARDAR INSPECCIÓN
========================================================= */

$('save').onclick = async () => {
  const zone = $('zone').value;
  const point = $('point').value;
  const observation = $('obs').value.trim();
  const result = $('result').value;
  const status = $('status').value;

  if (!zone || !point) {
    alert('Seleccione área y punto de inspección.');
    return;
  }

  if (result === 'CON INCIDENCIA' && !observation) {
    alert('Describa la observación de la incidencia.');
    return;
  }

  const button = $('save');
  button.disabled = true;

  try {
    const now = new Date();

    const record = {
      id: 'INS-' + now.getTime() + '-' +
        Math.random().toString(36).slice(2, 7),
      fecha: now.toISOString(),
      mes: $('month').value,
      anio: now.getFullYear(),
      zona: zone,
      punto: point,
      resultado: result,
      estado: result === 'SIN INCIDENCIA' ? '' : status,
      observacion: observation,
      fotos: [...photos],
      sync: 'PENDIENTE',
      fotosEnDrive: false
    };

    await put(record);

    alert('Inspección guardada en el teléfono correctamente.');
    reset();
    await show();

    if (driveUrl() && navigator.onLine) {
      await syncOne(record);
    }

  } catch (error) {
    console.error(error);
    alert('No se pudo guardar la inspección. Revise el almacenamiento del teléfono.');
  } finally {
    button.disabled = false;
  }
};

/* =========================================================
   10. MOSTRAR INSPECCIONES LOCALES
========================================================= */

async function removeRecord(id) {
  if (!confirm(
    '¿Desea eliminar esta inspección guardada del teléfono? ' +
    'Esta acción no se puede deshacer.'
  )) return;

  await del(id);
  await show();
}

async function show() {
  const records = (await all()).sort((a, b) =>
    String(b.fecha || '').localeCompare(String(a.fecha || ''))
  );

  $('records').innerHTML = records.slice(0, 30).map(record => `
    <div class="record">
      <b>${esc(record.zona)}</b> → ${esc(record.punto)}
      <br>
      <small>
        ${new Date(record.fecha).toLocaleString('es-PE')}
        · ${esc(record.resultado)}
        ${record.estado ? ' · ' + esc(record.estado) : ''}
        · ${record.sync === 'SINCRONIZADO'
          ? '☁️ Sincronizado'
          : '📱 Pendiente de sincronizar'}
      </small>
      <br>
      ${esc(record.observacion || 'Sin incidencia')}
      <div>
        ${(record.fotos || []).map(photo =>
          `<img class="thumb" src="${photo}" alt="Fotografía">`
        ).join('')}
        ${record.fotosEnDrive
          ? '<small>📷 Fotografías confirmadas en Google Drive</small>'
          : ''}
      </div>
      <button class="danger" data-delete-record="${esc(record.id)}">
        🗑️ Eliminar inspección
      </button>
    </div>
  `).join('') || '<small>No hay inspecciones guardadas.</small>';

  $('records').querySelectorAll('[data-delete-record]').forEach(button => {
    button.onclick = () => removeRecord(button.dataset.deleteRecord);
  });
}

/* =========================================================
   11. REPORTE LOCAL
========================================================= */

function localReport() {
  all().then(records => {
    const month = $('reportMonth').value;
    const year = Number($('reportYear').value);

    const rows = records.filter(x =>
      x.mes === month && Number(x.anio) === year
    ).sort((a, b) => {
      const z = String(a.zona || '').localeCompare(String(b.zona || ''), 'es');
      if (z) return z;
      const p = String(a.punto || '').localeCompare(String(b.punto || ''), 'es');
      return p || new Date(a.fecha) - new Date(b.fecha);
    });

    if (!rows.length) {
      alert('No hay inspecciones para el mes y año seleccionados.');
      return;
    }

    const zones = [...new Set(rows.map(x => x.zona))];
    const points = [...new Set(rows.map(x => x.zona + '|' + x.punto))];
    const incidents = rows.filter(x => x.resultado === 'CON INCIDENCIA').length;
    const pending = rows.filter(x => x.estado === 'PENDIENTE').length;
    const noIncidents = rows.filter(x => x.resultado === 'SIN INCIDENCIA').length;
    const photoCount = rows.reduce((n, x) => n + (x.fotos || []).length, 0);

    const metric = (value, label) =>
      `<div class="metric"><b>${value}</b><span>${label}</span></div>`;

    const photoGrid = (list, start) =>
      '<div class="photoGrid">' +
      list.map((photo, i) =>
        `<div class="photoCell">
          <img src="${photo}">
          <small>Foto ${start + i + 1}</small>
        </div>`
      ).join('') + '</div>';

    let html = `<!doctype html><html lang="es"><head>
      <meta charset="utf-8">
      <title>Reporte mensual ${esc(month)} ${year}</title>
      <style>
        @page{size:A4;margin:9mm}
        *{box-sizing:border-box}
        body{font:9pt Arial,sans-serif;color:#243447;margin:0}
        header{text-align:center;border-bottom:2px solid #142D4E;padding:4px 0 8px}
        h1{font-size:15pt;color:#142D4E;margin:0 0 5px}
        .period{font-weight:bold;color:#34495e}
        .small{font-size:7pt;color:#687786}
        .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:8px 0}
        .metric{border:1px solid #aebbc7;background:#f5f7fa;text-align:center;padding:5px}
        .metric b{display:block;color:#142D4E;font-size:12pt}
        .metric span{font-size:6.5pt;text-transform:uppercase;color:#526575}
        .area{background:#142D4E;color:white;padding:7px 9px;font-size:10pt;margin:10px 0 5px}
        .inspection{border:1px solid #c4ccd4;margin-bottom:7px}
        .point{background:#607D8B;color:white;padding:5px 8px;font-weight:bold}
        .info{padding:6px;font-size:7.5pt;line-height:1.35;overflow-wrap:anywhere}
        .photoBlock{margin:4px 5px 6px;padding:4px;background:#f1f4f7;border:1px solid #d4dbe2;break-inside:avoid}
        .photoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
        .photoCell{height:2.45cm;position:relative;border:1px solid #d4dbe2;background:white;overflow:hidden}
        .photoCell img{width:100%;height:100%;object-fit:contain}
        .photoCell small{position:absolute;right:3px;bottom:2px;background:#142D4E;color:white;padding:1px 3px}
        .inc{color:#b42318;font-weight:bold}.ok{color:#167044;font-weight:bold}
        @media print{.photoBlock,.photoGrid{break-inside:avoid}}
      </style></head><body>
      <header>
        <h1>REPORTE MENSUAL DE INSPECCIÓN DE INFRAESTRUCTURA</h1>
        <div class="period">MES: ${esc(month)} | AÑO: ${year}</div>
        <div class="small">Generado: ${new Date().toLocaleString('es-PE')}</div>
      </header>
      <section class="summary">
        ${metric(rows.length, 'Inspecciones')}
        ${metric(zones.length, 'Áreas')}
        ${metric(points.length, 'Puntos')}
        ${metric(incidents, 'Incidencias')}
        ${metric(pending, 'Pendientes')}
        ${metric(noIncidents, 'Sin incidencia')}
        ${metric(photoCount, 'Fotografías')}
        ${metric(rows.length, 'Registros locales')}
      </section>`;

    let lastZone = '';

    rows.forEach(record => {
      if (record.zona !== lastZone) {
        html += `<h2 class="area">ÁREA / ZONA: ${esc(record.zona)}</h2>`;
        lastZone = record.zona;
      }

      const images = record.fotos || [];

      html += `<section class="inspection">
        <div class="point">PUNTO DE INSPECCIÓN: ${esc(record.punto)}</div>
        <div class="info">
          <div><b>Fecha:</b> ${new Date(record.fecha).toLocaleString('es-PE')}</div>
          <div><b>Resultado:</b> <span class="${record.resultado === 'CON INCIDENCIA' ? 'inc' : 'ok'}">${esc(record.resultado)}</span></div>
          ${record.estado ? `<div><b>Estado:</b> ${esc(record.estado)}</div>` : ''}
          <div><b>Observación:</b> ${esc(record.observacion || 'Sin observación').replace(/\n/g, '<br>')}</div>
          <div><b>Fotografías:</b> ${images.length}</div>
        </div>`;

      for (let i = 0; i < images.length; i += 10) {
        html += `<div class="photoBlock">${photoGrid(images.slice(i, i + 10), i)}</div>`;
      }

      html += '</section>';
    });

    html += '</body></html>';

    const win = window.open('', '_blank');
    if (!win) {
      alert('El navegador bloqueó el reporte. Permita ventanas emergentes.');
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();
    win.onload = () => setTimeout(() => win.print(), 700);

  }).catch(error => {
    console.error(error);
    alert('No se pudo preparar el reporte local.');
  });
}

/* =========================================================
   12. REPORTE DESDE DRIVE
========================================================= */

function report() {
  const url = driveUrl();
  const month = $('reportMonth').value;
  const year = Number($('reportYear').value);

  if (!month || !Number.isInteger(year)) {
    alert('Seleccione un mes y año válido.');
    return;
  }

  if (!navigator.onLine) {
    alert('Sin Internet. Puede generar un reporte con los datos locales.');
    localReport();
    return;
  }

  const target = url + '?action=generateReport&view=1' +
    '&anio=' + encodeURIComponent(year) +
    '&mes=' + encodeURIComponent(month) +
    '&nombre=' + encodeURIComponent('Reporte_' + year + '_' + month);

  window.location.href = target;
}

$('report').onclick = report;

/* =========================================================
   13. INICIAR APLICACIÓN
========================================================= */

(async function init() {
  $('net').textContent = 'Cargando aplicación…';

  await openDB();

  $('net').textContent = 'Cargando catálogo…';

  const response = await fetch('catalog.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar catalog.json.');

  C = await response.json();

  $('month').innerHTML = C.months.map(x =>
    `<option value="${esc(x)}">${esc(x)}</option>`
  ).join('');

  $('reportMonth').innerHTML = C.months.map(x =>
    `<option value="${esc(x)}">${esc(x)}</option>`
  ).join('');

  const today = new Date();
  $('month').value = C.months[today.getMonth()];
  $('reportMonth').value = C.months[today.getMonth()];
  $('reportYear').value = today.getFullYear();

  $('zone').innerHTML =
    '<option value="">Seleccione una zona</option>' +
    C.zones.map(x =>
      `<option value="${esc(x.name)}">${esc(x.name)}</option>`
    ).join('');

  points();
  renderPhotos();
  await show();
  updateDriveStatus();

  $('net').textContent = navigator.onLine
    ? '● En línea'
    : '● Sin conexión — guardado local';

  window.addEventListener('online', async () => {
    $('net').textContent = '● En línea';
    if (driveUrl()) await syncPending(true);
  });

  window.addEventListener('offline', () => {
    $('net').textContent = '● Sin conexión — guardado local';
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  }

})().catch(error => {
  console.error('Error iniciando aplicación:', error);
  $('net').textContent = 'Error al iniciar la aplicación';
  alert('No se pudo iniciar la aplicación. Revise catalog.json y la consola.');
});
