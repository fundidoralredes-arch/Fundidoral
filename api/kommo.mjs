async function handleIncomingMessageWebhook(request) {
  const contentType =
    request.headers.get('content-type') || '';

  let incoming = null;

  /*
    Kommo documenta add_message como:
    {
      "add": [{
        "talk_id": "...",
        "text": "...",
        "entity_id": "...",
        "type": "incoming"
      }]
    }

    Dejamos también soporte para
    application/x-www-form-urlencoded.
  */
  if (contentType.includes('application/json')) {
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
      new URLSearchParams(bodyText);

    const getField = (field) => {
      /*
        Soporta:
        add[0][talk_id]
        add[1][talk_id]
        etc.
      */
      for (const [key, value] of params.entries()) {
        if (
          /^add\[\d+\]/.test(key) &&
          key.endsWith(`[${field}]`)
        ) {
          return value;
        }
      }

      /*
        Compatibilidad adicional por si
        Kommo envía otro prefijo.
      */
      for (const [key, value] of params.entries()) {
        if (
          key.includes('[add]') &&
          key.endsWith(`[${field}]`) &&
          !key.includes('[author]')
        ) {
          return value;
        }
      }

      return null;
    };

    incoming = {
      talk_id:
        getField('talk_id'),

      entity_id:
        getField('entity_id') ||
        getField('element_id'),

      text:
        getField('text'),

      type:
        getField('type'),

      origin:
        getField('origin')
    };
  }

  if (!incoming) {
    return {
      accepted: true,
      ignored: true,
      reason:
        'Kommo no envió un evento add_message reconocible.'
    };
  }

  const talkId =
    Number(incoming.talk_id);

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

  /*
    Solo procesamos mensajes entrantes.
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
    El lead donde entra WhatsApp puede ser
    diferente del lead creado por la landing.

    Ejemplo:
    WhatsApp lead: 22784516
    Referencia landing: FD-23213338
  */
  const referenceMatch =
    messageText.match(
      /Referencia:\s*FD-(\d+)/i
    );

  const landingLeadId =
    referenceMatch
      ? Number(referenceMatch[1])
      : whatsappLeadId;

  if (!landingLeadId) {
    return {
      accepted: true,
      ignored: true,
      reason:
        'No se encontró el lead de la landing.'
    };
  }

  /*
    Evitamos otros canales evidentemente
    distintos a WhatsApp.
  */
  if (
    origin &&
    origin.includes('telegram')
  ) {
    return {
      accepted: true,
      ignored: true,
      reason:
        'El mensaje pertenece a Telegram.'
    };
  }

  /*
    Buscamos el archivo guardado en el
    lead original de la landing.
  */
  const file =
    await getPendingLandingFile(
      landingLeadId
    );

  if (!file) {
    return {
      accepted: true,
      noPendingFile: true,
      landingLeadId,
      whatsappLeadId,
      talkId
    };
  }

  /*
    Mandamos ese mismo archivo al chat
    donde entró el mensaje de WhatsApp.
  */
  const result =
    await sendLandingFileToConversation(
      talkId,
      landingLeadId,
      file
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
