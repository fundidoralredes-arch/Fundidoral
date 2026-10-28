const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function clean(value, max = 2000) {
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
    clean(rawSubdomain, 100).replace(/[^a-zA-Z0-9-]/g, '') ||
    'fundidoral';

  if (!token) {
    throw new Error('Falta KOMMO_TOKEN en Vercel.');
  }

  return {
    token,
    subdomain
  };
}

async function parseResponse(res) {
  const text = await res.text();

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

  if (!res.ok) {
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
      `HTTP ${res.status}`;

    throw new Error(
      `Kommo respondió ${res.status}: ${clean(detail, 1500)}`
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

          if (
            name.includes('whatsapp')
          ) {
            score += 10;
          }

          if (
            name.includes('principal')
          ) {
            score += 5;
          }

          if (
            name.includes('embudo')
          ) {
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
      selected.pipeline?._embedded
        ?.statuses || [];

    /*
      Solo etapas normales.
      No utilizamos "Leads Entrantes"
      porque es una etapa especial.
    */
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

async function createLead(payload) {
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

  const placement =
    await getPipelinePlacement();

  const lead = {
    name:
      `Landing Web · ${product} · ${quantity} piezas`,
    ...placement
  };

  const created =
    await kommoFetch(
      '/api/v4/leads',
      {
        method: 'POST',

        body: JSON.stringify([
          lead
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

  /*
    Etiqueta opcional.
    Si falla, no interrumpimos la solicitud.
  */
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
            entity_id:
              leadId,

            note_type:
              'common',

            params: {
              text: note
            }
          }
        ])
      }
    );
  } catch (error) {
    /*
      Una nota no debe impedir
      que el lead quede creado.
    */
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

        body:
          JSON.stringify({
            file_name:
              fileName,

            /*
              Este es el tamaño REAL
              exacto del archivo.
            */
            file_size:
              fileSize,

            content_type:
              contentType,

            with_preview:
              contentType
                .startsWith('image/')
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

    /*
      El frontend respetará exactamente
      el tamaño máximo indicado por Kommo.
    */
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
    url.hostname
      .toLowerCase();

  if (
    !host.endsWith(
      '.kommo.com'
    )
  ) {
    throw new Error(
      'Host de subida inválido.'
    );
  }

  if (
    !url.pathname.includes(
      '/upload/'
    )
  ) {
    throw new Error(
      'Ruta de subida inválida.'
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

  /*
    Recibimos exactamente los bytes
    enviados por el navegador.
  */
  const buffer =
    await request.arrayBuffer();

  const bytes =
    buffer.byteLength;

  if (!bytes) {
    throw new Error(
      'El fragmento está vacío.'
    );
  }

  /*
    IMPORTANTE:
    NO usamos FormData aquí.

    Antes hacíamos:
      new FormData()
      form.append(...)

    Eso añadía headers/boundaries al cuerpo
    y Kommo terminaba recibiendo más bytes
    que el file_size declarado.

    Ahora reenviamos EXACTAMENTE el mismo
    ArrayBuffer.
  */
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
            'application/octet-stream',

          'Content-Length':
            String(bytes)
        },

        body:
          buffer
      }
    );

  const data =
    await parseResponse(
      response
    );

  /*
    Todavía faltan fragmentos.
  */
  if (data.next_url) {
    return {
      nextUrl:
        data.next_url
    };
  }

  /*
    Archivo terminado.
  */
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
        bytes
    };
  }

  throw new Error(
    'Kommo no confirmó la subida del archivo.'
  );
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
    Esta llamada coloca el archivo
    directamente en Media/Archivos
    del lead.
  */
  await kommoFetch(
    `/api/v4/leads/${leadId}/files`,
    {
      method: 'PUT',

      body:
        JSON.stringify([
          {
            file_uuid:
              fileUuid
          }
        ])
    }
  );

  /*
    Nota informativa opcional.
    No bloqueamos el proceso si falla.
  */
  try {
    await kommoFetch(
      '/api/v4/leads/notes',
      {
        method: 'POST',

        body:
          JSON.stringify([
            {
              entity_id:
                leadId,

              note_type:
                'common',

              params: {
                text:
                  `Archivo recibido desde la landing: ${fileName}`
              }
            }
          ])
      }
    );
  } catch (error) {
    console.warn(
      '[Fundidoral] Nota de archivo:',
      error?.message || error
    );
  }

  return {
    attached: true,
    leadId,
    fileUuid
  };
}

export default {
  async fetch(request) {
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
        La subida del fragmento
        NO es JSON.
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

      const payload =
        await request
          .json()
          .catch(
            () => ({})
          );

      if (
        action === 'create'
      ) {
        const result =
          await createLead(
            payload
          );

        return json({
          ok: true,
          ...result
        });
      }

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
