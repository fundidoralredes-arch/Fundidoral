const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8'
};

const FILE_MARKER = '__FUNDIDORAL_LANDING_FILE__';
const FILE_SENT_MARKER = '__FUNDIDORAL_LANDING_FILE_SENT__';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function clean(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalized(value) {
  return clean(value, 300)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function config() {
  const token = process.env.KOMMO_TOKEN;

  const rawSubdomain =
    process.env.KOMMO_SUBDOMAIN ||
    process.env['SUBDOMINIO KOMMO'] ||
    process.env.SUBDOMINIO_KOMMO ||
    'fundidoral';

  const subdomain =
    clean(rawSubdomain, 100)
      .replace(/[^a-zA-Z0-9-]/g, '') ||
    'fundidoral';

  if (!token) {
    throw new Error('Falta KOMMO_TOKEN en Vercel.');
  }

  return {
    token,
    subdomain
  };
}

async function parseResponse(response) {
  const text = await response.text();

  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text
      };
    }
  }

  if (!response.ok) {
    const validationErrors =
      Array.isArray(data?.['validation-errors'])
        ? data['validation-errors']
            .map((item) => {
              const field =
                item?.field ||
                item?.path ||
                '';

              const errors =
                Array.isArray(item?.errors)
                  ? item.errors
                      .map(
                        (error) =>
                          error?.detail ||
                          error?.message ||
                          error?.code ||
                          ''
                      )
                      .filter(Boolean)
                      .join(', ')
                  : '';

              return [field, errors]
                .filter(Boolean)
                .join(': ');
            })
            .filter(Boolean)
            .join(' | ')
        : '';

    const detail =
      validationErrors ||
      data?.detail ||
      data?.title ||
      data?.message ||
      data?.raw ||
      `HTTP ${response.status}`;

    throw new Error(
      `Kommo respondió ${response.status}: ${clean(detail, 1800)}`
    );
  }

  return data;
}

async function kommoFetch(path, options = {}) {
  const {
    token,
    subdomain
  } = config();

  const headers =
    new Headers(options.headers || {});

  headers.set(
    'Authorization',
    `Bearer ${token}`
  );

  headers.set(
    'Accept',
    'application/json'
  );

  if (
    options.body &&
    !headers.has('Content-Type')
  ) {
    headers.set(
      'Content-Type',
      'application/json'
    );
  }

  const response =
    await fetch(
      `https://${subdomain}.kommo.com${path}`,
      {
        ...options,
        headers
      }
    );

  return parseResponse(response);
}

/*
  Registra automáticamente el webhook
  de mensajes entrantes.

  Si falla, NO bloqueamos la creación
  del lead.
*/
async function ensureIncomingMessageWebhook(origin) {
  const destination =
    `${origin.replace(/\/$/, '')}/api/kommo?action=webhook`;

  try {
    const existing =
      await kommoFetch(
        `/api/v4/webhooks?filter[destination]=${encodeURIComponent(destination)}`
      );

    const webhooks =
      existing?._embedded?.webhooks || [];

    const alreadyExists =
      webhooks.some(
        (hook) =>
          hook.destination === destination &&
          Array.isArray(hook.settings) &&
          hook.settings.includes('add_message') &&
          !hook.disabled
      );

    if (alreadyExists) {
      return {
        ready: true,
        existing: true,
        destination
      };
    }

    await kommoFetch(
      '/api/v4/webhooks',
      {
        method: 'POST',
        body: JSON.stringify({
          destination,
          settings: ['add_message']
        })
      }
    );

    return {
      ready: true,
      existing: false,
      destination
    };
  } catch (error) {
    console.warn(
      '[Fundidoral] Webhook:',
      error?.message || error
    );

    return {
      ready: false,
      destination,
      error:
        error?.message ||
        'No se pudo registrar el webhook.'
    };
  }
}

async function getPipelinePlacement() {
  try {
    const data =
      await kommoFetch(
        '/api/v4/leads/pipelines'
      );

    const pipelines =
      data?._embedded?.pipelines || [];

    const ranked =
      pipelines
        .map((pipeline) => {
          const name =
            normalized(pipeline.name);

          let score = 0;

          if (name.includes('whatsapp')) {
            score += 10;
          }

          if (name.includes('principal')) {
            score += 5;
          }

          if (name.includes('embudo')) {
            score += 2;
          }

          return {
            pipeline,
            score
          };
        })
        .sort(
          (a, b) =>
            b.score - a.score
        );

    const selected =
      ranked[0];

    if (
      !selected ||
      selected.score === 0
    ) {
      return {};
    }

    const statuses =
      selected.pipeline?._embedded?.statuses ||
      [];

    const regular =
      statuses
        .filter(
          (status) =>
            Number(status.type) === 0
        )
        .filter(
          (status) =>
            ![142, 143].includes(
              Number(status.id)
            )
        )
        .sort(
          (a, b) =>
            Number(a.sort || 0) -
            Number(b.sort || 0)
        );

    const status =
      regular.find((item) =>
        normalized(item.name)
          .includes('informacion')
      ) ||
      regular.find((item) =>
        normalized(item.name)
          .includes('calificado')
      ) ||
      regular[0];

    return {
      pipeline_id:
        Number(
          selected.pipeline.id
        ) || undefined,

      status_id:
        Number(
          status?.id
        ) || undefined
    };
  } catch (error) {
    console.warn(
      '[Fundidoral] Pipeline:',
      error?.message || error
    );

    return {};
  }
}

async function createLead(payload, origin) {
  const product =
    clean(payload.product, 180);

  const material =
    clean(payload.material, 180);

  const quantity =
    Number(payload.quantity);

  const size =
    clean(payload.size, 180) ||
    'Por definir';

  const finish =
    clean(payload.finish, 180) ||
    'Por definir';

  const details =
    clean(payload.details, 1500) ||
    'Por definir';

  const fileName =
    clean(payload.fileName, 255);

  if (
    !product ||
    !material ||
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    throw new Error(
      'Faltan datos obligatorios de la cotización.'
    );
  }

  /*
    Importante:
    el fallo del webhook nunca debe impedir
    la creación del lead.
  */
  ensureIncomingMessageWebhook(origin)
    .catch(() => {});

  const placement =
    await getPipelinePlacement();

  const created =
    await kommoFetch(
      '/api/v4/leads',
      {
        method: 'POST',
        body: JSON.stringify([
          {
            name:
              `Landing Web · ${product} · ${quantity} piezas`,
            ...placement
          }
        ])
      }
    );

  const leadId =
    Number(
      created?._embedded
        ?.leads?.[0]?.id
    );

  if (!leadId) {
    throw new Error(
      'Kommo no devolvió el ID del lead.'
    );
  }

  try {
    await kommoFetch(
      '/api/v4/leads',
      {
        method: 'PATCH',
        body: JSON.stringify([
          {
            id: leadId,
            _embedded: {
              tags: [
                {
                  name: 'Landing Web'
                }
              ]
            }
          }
        ])
      }
    );
  } catch (error) {
    console.warn(
      '[Fundidoral] Etiqueta:',
      error?.message || error
    );
  }

  const note = [
    'Cotización recibida desde la landing web de Fundidoral.',
    '',
    `Referencia: FD-${leadId}`,
    '',
    `Producto: ${product}`,
    `Material: ${material}`,
    `Cantidad: ${quantity} piezas`,
    `Medidas: ${size}`,
    `Acabado: ${finish}`,
    `Detalles: ${details}`,
    fileName
      ? `Archivo: ${fileName}`
      : 'Archivo: No adjunto'
  ].join('\n');

  try {
    await kommoFetch(
      '/api/v4/leads/notes',
      {
        method: 'POST',
        body: JSON.stringify([
          {
            entity_id: leadId,
            note_type: 'common',
            params: {
              text: note
            }
          }
        ])
      }
    );
  } catch (error) {
    console.warn(
      '[Fundidoral] Nota:',
      error?.message || error
    );
  }

  return {
    leadId,
    reference:
      `FD-${leadId}`
  };
}

async function getDriveUrl() {
  const {
    token,
    subdomain
  } = config();

  const response =
    await fetch(
      `https://${subdomain}.kommo.com/api/v4/account?with=drive_url`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
          Accept:
            'application/json'
        }
      }
    );

  const account =
    await parseResponse(response);

  let drive =
    clean(
      account.drive_url,
      300
    );

  if (!drive) {
    throw new Error(
      'Kommo no devolvió drive_url.'
    );
  }

  if (
    !/^https?:\/\//i.test(drive)
  ) {
    drive =
      `https://${drive}`;
  }

  return drive.replace(
    /\/$/,
    ''
  );
}

async function createSession(payload) {
  const {
    token
  } = config();

  const fileName =
    clean(
      payload.fileName,
      255
    );

  const fileSize =
    Number(
      payload.fileSize
    );

  const contentType =
    clean(
      payload.contentType,
      180
    ) ||
    'application/octet-stream';

  if (
    !fileName ||
    !Number.isInteger(fileSize) ||
    fileSize <= 0
  ) {
    throw new Error(
      'Datos del archivo inválidos.'
    );
  }

  const driveUrl =
    await getDriveUrl();

  const response =
    await fetch(
      `${driveUrl}/v1.0/sessions`,
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${token}`,
          Accept:
            'application/json',
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          file_name: fileName,
          file_size: fileSize,
          content_type: contentType,
          with_preview:
            contentType.startsWith(
              'image/'
            )
        })
      }
    );

  const session =
    await parseResponse(
      response
    );

  if (!session.upload_url) {
    throw new Error(
      'Kommo no generó upload_url.'
    );
  }

  if (
    session.max_file_size &&
    fileSize >
      Number(
        session.max_file_size
      )
  ) {
    throw new Error(
      'El archivo supera el tamaño máximo permitido por Kommo.'
    );
  }

  return {
    uploadUrl:
      session.upload_url,

    maxPartSize:
      Number(
        session.max_part_size
      ) || 131072,

    maxFileSize:
      Number(
        session.max_file_size
      ) || null
  };
}

function validUploadUrl(value) {
  const url =
    new URL(value);

  if (
    url.protocol !== 'https:'
  ) {
    throw new Error(
      'URL de subida inválida.'
    );
  }

  const host =
    url.hostname.toLowerCase();

  if (
    !(
      host === 'kommo.com' ||
      host.endsWith(
        '.kommo.com'
      )
    )
  ) {
    throw new Error(
      'Host de subida inválido.'
    );
  }

  return url.toString();
}

async function uploadPart(
  request,
  uploadUrl
) {
  const {
    token
  } = config();

  const target =
    validUploadUrl(
      uploadUrl
    );

  const buffer =
    await request.arrayBuffer();

  if (!buffer.byteLength) {
    throw new Error(
      'El fragmento está vacío.'
    );
  }

  const response =
    await fetch(
      target,
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${token}`,
          Accept:
            'application/json',
          'Content-Type':
            'application/octet-stream'
        },

        body: buffer
      }
    );

  const data =
    await parseResponse(
      response
    );

  if (data.next_url) {
    return {
      nextUrl:
        data.next_url
    };
  }

  if (data.uuid) {
    return {
      fileUuid:
        data.uuid,

      versionUuid:
        data.version_uuid ||
        null,

      name:
        data.name ||
        null,

      size:
        data.size ||
        buffer.byteLength
    };
  }

  throw new Error(
    'Kommo no confirmó la subida del archivo.'
  );
}

function chatAttachmentType(
  fileName
) {
  const name =
    clean(
      fileName,
      255
    ).toLowerCase();

  if (
    /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(
      name
    )
  ) {
    return 'picture';
  }

  return 'file';
}

async function attachFile(payload) {
  const leadId =
    Number(
      payload.leadId
    );

  const fileUuid =
    clean(
      payload.fileUuid,
      120
    );

  const versionUuid =
    clean(
      payload.versionUuid,
      120
    );

  const fileName =
    clean(
      payload.fileName,
      255
    ) ||
    'Archivo de diseño';

  if (
    !leadId ||
    !fileUuid
  ) {
    throw new Error(
      'No se pudo identificar el lead o el archivo.'
    );
  }

  /*
    Adjuntamos el archivo al lead.
  */
  await kommoFetch(
    `/api/v4/leads/${leadId}/files`,
    {
      method: 'PUT',
      body: JSON.stringify([
        {
          file_uuid:
            fileUuid
        }
      ])
    }
  );

  /*
    Guardamos los UUID necesarios
    para luego mandar el archivo
    al chat de WhatsApp.
  */
  const markerPayload = {
    fileUuid,

    versionUuid:
      versionUuid || null,

    fileName,

    type:
      chatAttachmentType(
        fileName
      )
  };

  await kommoFetch(
    '/api/v4/leads/notes',
    {
      method: 'POST',

      body: JSON.stringify([
        {
          entity_id:
            leadId,

          note_type:
            'common',

          params: {
            text:
              `Archivo recibido desde la landing: ${fileName}`
          }
        },

        {
          entity_id:
            leadId,

          note_type:
            'common',

          params: {
            text:
              `${FILE_MARKER}${JSON.stringify(markerPayload)}`
          }
        }
      ])
    }
  );

  return {
    attached: true,
    leadId,
    fileUuid,
    versionUuid:
      versionUuid || null
  };
}

function noteText(note) {
  return clean(
    note?.params?.text,
    10000
  );
}

async function getPendingLandingFile(
  leadId
) {
  const data =
    await kommoFetch(
      `/api/v4/leads/${leadId}/notes?limit=250&order[id]=desc`
    );

  const notes =
    data?._embedded?.notes || [];

  const sent =
    new Set(
      notes
        .map(noteText)
        .filter(
          (text) =>
            text.startsWith(
              FILE_SENT_MARKER
            )
        )
        .map(
          (text) =>
            text.slice(
              FILE_SENT_MARKER.length
            )
        )
    );

  for (const note of notes) {
    const text =
      noteText(note);

    if (
      !text.startsWith(
        FILE_MARKER
      )
    ) {
      continue;
    }

    try {
      const payload =
        JSON.parse(
          text.slice(
            FILE_MARKER.length
          )
        );

      if (
        payload?.fileUuid &&
        !sent.has(
          payload.fileUuid
        )
      ) {
        return payload;
      }
    } catch {
      // Ignoramos marcadores inválidos.
    }
  }

  return null;
}

async function sendLandingFileToConversation(
  talkId,
  landingLeadId,
  file
) {
  if (
    !talkId ||
    !landingLeadId ||
    !file?.fileUuid
  ) {
    return {
      sent: false
    };
  }

  const body = {
    attachment: {
      drive_uuid:
        file.fileUuid,

      type:
        file.type ||
        'file'
    }
  };

  if (file.versionUuid) {
    body.attachment.drive_version_uuid =
      file.versionUuid;
  }

  /*
    Endpoint de Kommo para enviar
    un mensaje/archivo a la conversación.
  */
  await kommoFetch(
    `/api/v4/talks/${talkId}/send_message`,
    {
      method: 'POST',
      body:
        JSON.stringify(body)
    }
  );

  /*
    Marcamos el archivo como enviado
    para evitar duplicados.
  */
  await kommoFetch(
    '/api/v4/leads/notes',
    {
      method: 'POST',

      body:
        JSON.stringify([
          {
            entity_id:
              landingLeadId,

            note_type:
              'common',

            params: {
              text:
                `${FILE_SENT_MARKER}${file.fileUuid}`
            }
          },

          {
            entity_id:
              landingLeadId,

            note_type:
              'common',

            params: {
              text:
                `Archivo enviado automáticamente al chat de WhatsApp: ${file.fileName || 'archivo'}`
            }
          }
        ])
    }
  );

  return {
    sent: true
  };
}

/*
  Extrae valores de webhooks Kommo
  enviados como x-www-form-urlencoded.

  Soporta:
  add[0][talk_id]
  add[0][text]
  add[0][entity_id]
  add[0][type]
*/
function getWebhookField(
  params,
  field
) {
  for (
    const [key, value]
    of params.entries()
  ) {
    if (
      /^add\[\d+\]\[[^\]]+\]$/.test(
        key
      ) &&
      key.endsWith(
        `[${field}]`
      )
    ) {
      return value;
    }
  }

  /*
    Compatibilidad adicional
    por si Kommo usa otro prefijo.
  */
  for (
    const [key, value]
    of params.entries()
  ) {
    if (
      key.includes('[add]') &&
      key.endsWith(
        `[${field}]`
      ) &&
      !key.includes('[author]')
    ) {
      return value;
    }
  }

  return null;
}

async function handleIncomingMessageWebhook(
  request
) {
  const contentType =
    request.headers.get(
      'content-type'
    ) || '';

  let incoming = null;

  /*
    Aunque Kommo documenta el webhook
    como x-www-form-urlencoded,
    soportamos JSON también para seguridad.
  */
  if (
    contentType.includes(
      'application/json'
    )
  ) {
    const body =
      await request
        .json()
        .catch(() => ({}));

    incoming =
      Array.isArray(body?.add)
        ? body.add[0]
        : null;
  } else {
    const bodyText =
      await request.text();

    const params =
      new URLSearchParams(
        bodyText
      );

    incoming = {
      talk_id:
        getWebhookField(
          params,
          'talk_id'
        ),

      entity_id:
        getWebhookField(
          params,
          'entity_id'
        ) ||
        getWebhookField(
          params,
          'element_id'
        ),

      element_id:
        getWebhookField(
          params,
          'element_id'
        ),

      text:
        getWebhookField(
          params,
          'text'
        ),

      type:
        getWebhookField(
          params,
          'type'
        ),

      origin:
        getWebhookField(
          params,
          'origin'
        )
    };
  }

  if (!incoming) {
    console.log(
      '[Fundidoral webhook] Evento no reconocido.'
    );

    return {
      accepted: true,
      ignored: true,
      reason:
        'Evento no reconocido.'
    };
  }

  const talkId =
    Number(
      incoming.talk_id
    );

  const whatsappLeadId =
    Number(
      incoming.entity_id ||
      incoming.element_id
    );

  const type =
    clean(
      incoming.type,
      30
    ).toLowerCase();

  const messageText =
    clean(
      incoming.text,
      10000
    );

  const origin =
    clean(
      incoming.origin,
      100
    ).toLowerCase();

  console.log(
    '[Fundidoral webhook]',
    {
      talkId,
      whatsappLeadId,
      type,
      origin,
      messageText:
        messageText.slice(
          0,
          500
        )
    }
  );

  /*
    Solo mensajes entrantes.
  */
  if (
    !talkId ||
    type !== 'incoming'
  ) {
    return {
      accepted: true,
      ignored: true,
      reason:
        'No es un mensaje entrante válido.',
      talkId,
      type
    };
  }

  /*
    Buscamos:
    Referencia: FD-23213338

    Ese número corresponde al lead
    creado por la landing, aunque
    WhatsApp esté usando otro lead.
  */
  const referenceMatch =
    messageText.match(
      /Referencia:\s*FD-(\d+)/i
    );

  const landingLeadId =
    referenceMatch
      ? Number(
          referenceMatch[1]
        )
      : whatsappLeadId;

  console.log(
    '[Fundidoral webhook] Relación',
    {
      whatsappLeadId,
      landingLeadId,
      talkId
    }
  );

  if (!landingLeadId) {
    return {
      accepted: true,
      ignored: true,
      reason:
        'No se encontró el lead de la landing.'
    };
  }

  /*
    Ignoramos Telegram.
    Para WhatsApp el origin puede
    variar según el conector.
  */
  if (
    origin &&
    origin.includes(
      'telegram'
    )
  ) {
    return {
      accepted: true,
      ignored: true,
      reason:
        'Canal Telegram.'
    };
  }

  const file =
    await getPendingLandingFile(
      landingLeadId
    );

  if (!file) {
    console.log(
      '[Fundidoral webhook] No hay archivo pendiente',
      {
        landingLeadId
      }
    );

    return {
      accepted: true,
      noPendingFile: true,
      landingLeadId,
      whatsappLeadId,
      talkId
    };
  }

  console.log(
    '[Fundidoral webhook] Archivo encontrado',
    {
      landingLeadId,
      fileUuid:
        file.fileUuid,
      versionUuid:
        file.versionUuid,
      fileName:
        file.fileName
    }
  );

  const result =
    await sendLandingFileToConversation(
      talkId,
      landingLeadId,
      file
    );

  console.log(
    '[Fundidoral webhook] Resultado',
    result
  );

  return {
    accepted: true,
    landingLeadId,
    whatsappLeadId,
    talkId,
    reference:
      `FD-${landingLeadId}`,
    ...result
  };
}

export default {
  async fetch(request) {
    const url =
      new URL(
        request.url
      );

    const action =
      url.searchParams.get(
        'action'
      );

    try {
      /*
        WEBHOOK KOMMO
      */
      if (
        request.method === 'POST' &&
        action === 'webhook'
      ) {
        const result =
          await handleIncomingMessageWebhook(
            request
          );

        return json({
          ok: true,
          ...result
        });
      }

      if (
        request.method !== 'POST'
      ) {
        return json(
          {
            ok: false,
            error:
              'Método no permitido.'
          },
          405
        );
      }

      /*
        SUBIDA DE FRAGMENTOS
      */
      if (
        action === 'part'
      ) {
        const uploadUrl =
          url.searchParams.get(
            'url'
          ) || '';

        const result =
          await uploadPart(
            request,
            uploadUrl
          );

        return json({
          ok: true,
          ...result
        });
      }

      /*
        JSON para las demás acciones.
      */
      const payload =
        await request
          .json()
          .catch(
            () => ({})
          );

      /*
        CREAR LEAD
      */
      if (
        action === 'create'
      ) {
        const result =
          await createLead(
            payload,
            url.origin
          );

        return json({
          ok: true,
          ...result
        });
      }

      /*
        CREAR SESIÓN DE ARCHIVO
      */
      if (
        action === 'session'
      ) {
        const result =
          await createSession(
            payload
          );

        return json({
          ok: true,
          ...result
        });
      }

      /*
        ADJUNTAR ARCHIVO AL LEAD
      */
      if (
        action === 'attach'
      ) {
        const result =
          await attachFile(
            payload
          );

        return json({
          ok: true,
          ...result
        });
      }

      return json(
        {
          ok: false,
          error:
            'Acción no válida.'
        },
        400
      );
    } catch (error) {
      console.error(
        '[Fundidoral Kommo]',
        error
      );

      return json(
        {
          ok: false,

          error:
            error?.message ||
            'Error al conectar con Kommo.'
        },
        500
      );
    }
  }
};
