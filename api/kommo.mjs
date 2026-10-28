const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function safeText(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalize(value) {
  return safeText(value, 300)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getConfig() {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN || process.env['SUBDOMINIO KOMMO'] || process.env.SUBDOMINIO_KOMMO || 'fundidoral';
  if (!token) throw new Error('Falta KOMMO_TOKEN en Vercel.');
  return { token, subdomain: safeText(subdomain, 100).replace(/[^a-zA-Z0-9-]/g, '') || 'fundidoral' };
}

async function parseJsonResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data?.detail || data?.title || data?.message || data?.raw || `HTTP ${res.status}`;
    throw new Error(`Kommo respondió ${res.status}: ${safeText(detail, 500)}`);
  }
  return data;
}

async function kommoFetch(path, options = {}) {
  const { token, subdomain } = getConfig();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`https://${subdomain}.kommo.com${path}`, { ...options, headers });
  return parseJsonResponse(res);
}

async function choosePipeline() {
  try {
    const data = await kommoFetch('/api/v4/leads/pipelines');
    const pipelines = data?._embedded?.pipelines || [];
    const target = pipelines
      .map((pipeline) => {
        const name = normalize(pipeline.name);
        let score = 0;
        if (name.includes('whatsapp')) score += 10;
        if (name.includes('principal')) score += 4;
        if (name.includes('embudo')) score += 1;
        return { pipeline, score };
      })
      .sort((a, b) => b.score - a.score)[0];

    if (!target || target.score === 0) return {};
    const statuses = target.pipeline?._embedded?.statuses || [];
    const status = statuses.find((s) => normalize(s.name).includes('leads entrantes'))
      || statuses.find((s) => normalize(s.name).includes('entrante'))
      || statuses.find((s) => ![142, 143].includes(Number(s.id)));

    return {
      pipeline_id: Number(target.pipeline.id) || undefined,
      status_id: Number(status?.id) || undefined
    };
  } catch {
    return {};
  }
}

async function createLead(payload) {
  const product = safeText(payload.product, 180);
  const material = safeText(payload.material, 180);
  const quantity = Number(payload.quantity);
  const size = safeText(payload.size, 180) || 'Por definir';
  const finish = safeText(payload.finish, 180) || 'Por definir';
  const details = safeText(payload.details, 1500) || 'Por definir';
  const fileName = safeText(payload.fileName, 255);

  if (!product || !material || !Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Faltan datos obligatorios de la cotización.');
  }

  const placement = await choosePipeline();
  const lead = {
    name: `Landing Web · ${product} · ${quantity} piezas`,
    ...placement,
    _embedded: { tags: [{ name: 'Landing Web' }] }
  };

  const created = await kommoFetch('/api/v4/leads', {
    method: 'POST',
    body: JSON.stringify([lead])
  });
  const leadId = Number(created?._embedded?.leads?.[0]?.id);
  if (!leadId) throw new Error('Kommo no devolvió el ID del lead.');

  const noteText = [
    'Cotización recibida desde la landing web de Fundidoral.',
    `Referencia: FD-${leadId}`,
    '',
    `Producto: ${product}`,
    `Material: ${material}`,
    `Cantidad: ${quantity} piezas`,
    `Medidas: ${size}`,
    `Acabado: ${finish}`,
    `Detalles: ${details}`,
    fileName ? `Archivo seleccionado: ${fileName} (carga en proceso)` : 'Archivo seleccionado: No adjunto'
  ].join('\n');

  await kommoFetch('/api/v4/leads/notes', {
    method: 'POST',
    body: JSON.stringify([{ entity_id: leadId, note_type: 'common', params: { text: noteText } }])
  });

  return { leadId, reference: `FD-${leadId}` };
}

async function createUploadSession(payload) {
  const { token, subdomain } = getConfig();
  const leadId = Number(payload.leadId);
  const fileName = safeText(payload.fileName, 255);
  const fileSize = Number(payload.fileSize);
  const contentType = safeText(payload.contentType, 180) || 'application/octet-stream';

  if (!leadId || !fileName || !Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('Datos de archivo inválidos.');
  }

  const accountRes = await fetch(`https://${subdomain}.kommo.com/api/v4/account?with=drive_url`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const account = await parseJsonResponse(accountRes);
  let driveUrl = safeText(account.drive_url, 300);
  if (!driveUrl) throw new Error('Kommo no devolvió la dirección del servicio de archivos.');
  if (!/^https?:\/\//i.test(driveUrl)) driveUrl = `https://${driveUrl}`;
  driveUrl = driveUrl.replace(/\/$/, '');

  const sessionRes = await fetch(`${driveUrl}/v1.0/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType,
      with_preview: contentType.startsWith('image/')
    })
  });
  const session = await parseJsonResponse(sessionRes);

  if (!session.upload_url) throw new Error('Kommo no generó la URL de carga del archivo.');
  if (session.max_file_size && fileSize > Number(session.max_file_size)) {
    throw new Error('El archivo supera el tamaño máximo permitido por Kommo.');
  }

  return {
    uploadUrl: session.upload_url,
    maxPartSize: Number(session.max_part_size) || 131072,
    maxFileSize: Number(session.max_file_size) || null
  };
}

function validateUploadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('URL de carga inválida.');
  const host = url.hostname.toLowerCase();
  if (!(host === 'kommo.com' || host.endsWith('.kommo.com'))) throw new Error('Host de carga inválido.');
  if (!url.pathname.includes('/upload/')) throw new Error('Ruta de carga inválida.');
  return url.toString();
}

async function uploadPart(request, uploadUrl) {
  const { token } = getConfig();
  const target = validateUploadUrl(uploadUrl);
  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) throw new Error('La parte del archivo está vacía.');
  if (buffer.byteLength > 2 * 1024 * 1024) throw new Error('La parte del archivo es demasiado grande.');

  const form = new FormData();
  form.append('RAW_BODY', new Blob([buffer], { type: 'application/octet-stream' }), 'part.bin');

  const res = await fetch(target, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body: form
  });
  const data = await parseJsonResponse(res);

  if (data.next_url) return { nextUrl: data.next_url };
  if (data.uuid) {
    return {
      fileUuid: data.uuid,
      versionUuid: data.version_uuid || null,
      name: data.name || null,
      size: data.size || null
    };
  }
  throw new Error('Kommo no devolvió el siguiente paso ni el archivo final.');
}

async function attachFile(payload) {
  const leadId = Number(payload.leadId);
  const fileUuid = safeText(payload.fileUuid, 100);
  const versionUuid = safeText(payload.versionUuid, 100);
  const fileName = safeText(payload.fileName, 255) || 'Archivo de diseño';
  if (!leadId || !fileUuid) throw new Error('No se pudo identificar el lead o el archivo.');

  await kommoFetch(`/api/v4/leads/${leadId}/files`, {
    method: 'PUT',
    body: JSON.stringify([{ file_uuid: fileUuid }])
  });

  const createdAt = Math.floor(Date.now() / 1000);
  const notes = [
    {
      entity_id: leadId,
      created_at: createdAt,
      note_type: 'common',
      params: { text: `Archivo recibido desde la landing: ${fileName}` }
    },
    {
      entity_id: leadId,
      created_at: createdAt,
      note_type: 'attachment',
      params: {
        file_uuid: fileUuid,
        ...(versionUuid ? { version_uuid: versionUuid } : {}),
        file_name: fileName
      }
    }
  ];

  await kommoFetch('/api/v4/leads/notes', {
    method: 'POST',
    body: JSON.stringify(notes)
  });

  return { attached: true };
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return responseJson({ ok: false, error: 'Método no permitido.' }, 405);
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    try {
      if (action === 'part') {
        const result = await uploadPart(request, url.searchParams.get('url') || '');
        return responseJson({ ok: true, ...result });
      }

      const payload = await request.json().catch(() => ({}));
      if (action === 'create') return responseJson({ ok: true, ...(await createLead(payload)) });
      if (action === 'session') return responseJson({ ok: true, ...(await createUploadSession(payload)) });
      if (action === 'attach') return responseJson({ ok: true, ...(await attachFile(payload)) });
      return responseJson({ ok: false, error: 'Acción no válida.' }, 400);
    } catch (error) {
      console.error('[Fundidoral Kommo]', error);
      return responseJson({ ok: false, error: error?.message || 'Error al conectar con Kommo.' }, 500);
    }
  }
};
