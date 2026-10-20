// Llamada a Google Gemini en streaming, para usar desde Edge Functions de Netlify.
// La respuesta se envía al navegador poco a poco (una línea JSON por evento), así
// Netlify no corta la conexión aunque Gemini tarde en terminar.
//
// Eventos que recibe el navegador (uno por línea):
//   {"estado":"..."}   mensaje de progreso
//   {"t":"..."}        trozo de texto generado por la IA
//   {"error":"..."}    algo falló
//   {"fin":true}       terminado

const MODELOS = () => [
  { modelo: Netlify.env.get("GEMINI_MODEL") || "gemini-3.8-flash", pensar: "low" },
  { modelo: "gemini-3.5-flash-lite" },
];
// Si Google está saturado (503/429), se vuelve a probar con todos los modelos
// tras esperar estos segundos.
const ESPERAS_REINTENTO = [3, 8, 15];
const INTENTOS = () => {
  const lista = [];
  [0, ...ESPERAS_REINTENTO].forEach((espera, ronda) =>
    MODELOS().forEach((m, i) => lista.push({ ...m, espera: i === 0 ? espera : 0, ronda })));
  return lista;
};
const dormir = (s) => new Promise((r) => setTimeout(r, s * 1000));

// Si en este tiempo Gemini no ha empezado a escribir, se prueba el siguiente modelo.
const ESPERA_PRIMER_TEXTO_MS = 45000;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function textoFuentes(fuentes, max) {
  if (!Array.isArray(fuentes) || !fuentes.length) return "";
  const porFuente = Math.floor(max / fuentes.length);
  return fuentes
    .map((f, i) => `--- FUENTE ${i + 1}: ${f.nombre || "sin nombre"} ---\n${String(f.texto || "").slice(0, porFuente)}`)
    .join("\n\n");
}

// Devuelve una Response que empieza a enviar datos al momento.
export function respuestaEnDirecto({ sistema, mensajes, maxTokens, json: modoJSON }) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const enviar = (obj) => ctrl.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        enviar({ estado: "Conectando con la IA…" });
        await generar({ sistema, mensajes, maxTokens, modoJSON }, enviar);
        enviar({ fin: true });
      } catch (e) {
        enviar({ error: e.message || String(e) });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

async function generar({ sistema, mensajes, maxTokens, modoJSON }, enviar) {
  const clave = Netlify.env.get("GEMINI_API_KEY");
  if (!clave) throw new Error("Falta la variable GEMINI_API_KEY en Netlify");

  let ultimoError;
  for (const { modelo, pensar, espera, ronda } of INTENTOS()) {
    if (espera) {
      enviar({ estado: `Google está saturado, reintentando (${ronda}/${ESPERAS_REINTENTO.length})…` });
      await dormir(espera);
    }
    const cuerpo = {
      systemInstruction: { parts: [{ text: sistema }] },
      contents: mensajes.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(modoJSON ? { responseMimeType: "application/json" } : {}),
        ...(pensar ? { thinkingConfig: { thinkingLevel: pensar } } : {}),
      },
    };

    const corte = new AbortController();
    const temporizador = setTimeout(() => corte.abort(), ESPERA_PRIMER_TEXTO_MS);
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
          body: JSON.stringify(cuerpo),
          signal: corte.signal,
        },
      );
    } catch {
      clearTimeout(temporizador);
      ultimoError = new Error(`Gemini (${modelo}) no respondió`);
      enviar({ estado: "Probando con un modelo más rápido…" });
      continue;
    }

    if (!res.ok) {
      clearTimeout(temporizador);
      const data = await res.json().catch(() => ({}));
      const msg = (Array.isArray(data) ? data[0] : data)?.error?.message || "";
      ultimoError = new Error(`Gemini (${modelo}) error ${res.status}: ${msg}`);
      const reintentable = [404, 429, 500, 503].includes(res.status) || (res.status === 400 && /think/i.test(msg));
      if (!reintentable) break; // p. ej. clave mala: no tiene sentido reintentar
      if (res.status === 503 || res.status === 429) {
        ultimoError = new Error("Los servidores de Google están saturados ahora mismo. Espera un par de minutos y vuelve a intentarlo.");
      }
      enviar({ estado: "Probando con otro modelo…" });
      continue;
    }

    enviar({ estado: "La IA está escribiendo…" });
    const progreso = { escrito: false };
    try {
      await reenviarSSE(res.body, enviar, progreso, () => clearTimeout(temporizador));
    } catch (e) {
      clearTimeout(temporizador);
      if (progreso.escrito) throw new Error("Se cortó la respuesta de la IA. Inténtalo de nuevo.");
      ultimoError = new Error(`Gemini (${modelo}) tardó demasiado en empezar`);
      enviar({ estado: "Probando con un modelo más rápido…" });
      continue;
    }
    clearTimeout(temporizador);
    if (progreso.escrito) return;
    ultimoError = new Error("Gemini no devolvió texto");
  }
  throw ultimoError;
}

// Lee los eventos SSE de Gemini y reenvía solo el texto (sin el "pensamiento").
async function reenviarSSE(cuerpo, enviar, progreso, alPrimerTexto) {
  const lector = cuerpo.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await lector.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let corte;
    while ((corte = buffer.indexOf("\n")) !== -1) {
      const linea = buffer.slice(0, corte).trim();
      buffer = buffer.slice(corte + 1);
      if (!linea.startsWith("data:")) continue;
      let evento;
      try { evento = JSON.parse(linea.slice(5)); } catch { continue; }
      if (evento.error) throw new Error(evento.error.message || "Error de Gemini");
      const partes = evento.candidates?.[0]?.content?.parts || [];
      const texto = partes.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
      if (texto) {
        if (!progreso.escrito) alPrimerTexto();
        progreso.escrito = true;
        enviar({ t: texto });
      }
    }
  }
}
