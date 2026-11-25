(() => {
  const saveButton = document.getElementById('saveReportDrive');
  const DEFAULT_DRIVE_URL = 'https://script.google.com/a/macros/aliexperu.com.pe/s/AKfycby0D5sphuxMTUVH3WTLt6-jbiTMUwTUpsJAZhODWdz09fdTg7i0ctqP3MojYRr8zgTD/exec';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const getConfig = () => ({
    url: (localStorage.getItem('inspecciones_drive_url_v2_repo') || DEFAULT_DRIVE_URL).trim(),
    mes: document.getElementById('reportMonth').value,
    anio: Number(document.getElementById('reportYear').value)
  });

  function sendPost(url, payload) {
    return new Promise((resolve, reject) => {
      const target = 'report_post_' + Date.now() + '_' + Math.random().toString(36).slice(2);
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
      field.value = JSON.stringify(payload);
      form.appendChild(field);
      document.body.appendChild(frame);
      document.body.appendChild(form);
      try {
        form.submit();
        resolve(true);
      } catch (error) {
        reject(error);
      } finally {
        setTimeout(() => {
          if (form.parentNode) form.parentNode.removeChild(form);
          if (frame.parentNode) frame.parentNode.removeChild(frame);
        }, 150000);
      }
    });
  }

  function checkReport(url, anio, mes, nombre) {
    return new Promise(resolve => {
      const callback = 'reportCheck_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let finished = false;
      const timer = setTimeout(() => done(null), 10000);
      function done(result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        delete window[callback];
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(result && result.ok ? result : null);
      }
      window[callback] = done;
      script.onerror = () => done(null);
      script.src = url + '?action=checkReport&anio=' + encodeURIComponent(anio) +
        '&mes=' + encodeURIComponent(mes) + '&nombre=' + encodeURIComponent(nombre) +
        '&prefix=' + encodeURIComponent(callback) + '&t=' + Date.now();
      document.body.appendChild(script);
    });
  }

  async function saveReportToDrive() {
    const { url, mes, anio } = getConfig();
    if (!url) return alert('Primero conecte Google Drive.');
    if (!navigator.onLine) return alert('No hay Internet. Para guardar el reporte en Google Drive necesita conexión.');
    if (!mes || !Number.isInteger(anio) || anio < 2000 || anio > 2100) {
      return alert('Seleccione un mes y un año válido.');
    }

    const nombre = 'Reporte_' + anio + '_' + mes;
    const oldText = saveButton ? saveButton.textContent : '';
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = '⏳ Generando y verificando PDF…';
    }

    try {
      await sendPost(url, { action: 'syncReport', anio, mes, nombre });
      for (let attempt = 0; attempt < 40; attempt++) {
        if (!navigator.onLine) throw new Error('Se perdió la conexión a Internet.');
        const result = await checkReport(url, anio, mes, nombre);
        if (result) {
          alert('☁️ Reporte PDF confirmado en Google Drive.\n\n' +
            'Carpeta: INSPECCIONES_INFRAESTRUCTURA_2 → REPORTES_MENSUALES_2 → ' +
            anio + ' → ' + mes + '\n\nEl archivo ya existe en Drive.');
          return;
        }
        await sleep(2500);
      }
      throw new Error('Google Apps Script no confirmó que el PDF exista en Drive. Revise Apps Script > Ejecuciones. No se mostrará como guardado hasta confirmarlo.');
    } catch (error) {
      console.error('Error guardando el reporte en Drive:', error);
      alert('❌ No se pudo confirmar el reporte en Google Drive.\n\n' +
        (error && error.message ? error.message : error) +
        '\n\nLas inspecciones originales permanecen guardadas en el teléfono.');
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = oldText || '☁️ Guardar reporte en Drive';
      }
    }
  }

  if (saveButton) saveButton.onclick = saveReportToDrive;
})();