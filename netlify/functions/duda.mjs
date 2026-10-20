// Responde dudas sobre una micro acción concreta de un trabajo (chat), usando las fuentes del trabajo.
// Llamada a Google Gemini con tu propia clave (variable GEMINI_API_KEY en Netlify).
// Usa Flash pensando poco; si tarda, se alcanza el límite gratuito o falla, pasa a Flash-Lite.
// Netlify corta las funciones a los 30 s, así que cada intento tiene un tiempo máximo.
const INTENTOS = [
  { modelo: process.env.GEMINI_MODEL || "gemini-3.8-flash", pensar: "low", maxMs: 17000 },
  { modelo: "gemini-3.5-flash-lite", maxMs: 11000 },
];

async function gemini({ sistema, mensajes, maxTokens, json: modoJSON }) {
  const clave = process.env.GEMINI_API_KEY;
  if (!clave) throw new Error("Falta la variable GEMINI_API_KEY en Netlify");
  let ultimoError;
  for (const { modelo, pensar, maxMs } of INTENTOS) {
    const cuerpo = {
      systemInstruction: { parts: [{ text: sistema }] },
      contents: mensajes.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(modoJSON ? { responseMimeType: "application/json" } : {}),
        ...(pensar ? { thinkingConfig: { thinkingLevel: pensar } } : {}),
      },
    };
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(maxMs),
      });
    } catch (e) {
      ultimoError = new Error(`Gemini (${modelo}) tardó demasiado`);
      continue; // tiempo agotado: probar el siguiente modelo
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const partes = data.candidates?.[0]?.content?.parts || [];
      const texto = partes.filter((p) => !p.thought && p.text).map((p) => p.text).join("").trim();
      if (texto) return texto;
      ultimoError = new Error("Gemini no devolvió texto");
      continue;
    }
    const msg = data.error?.message || "";
    ultimoError = new Error(`Gemini (${modelo}) error ${res.status}: ${msg}`);
    const reintentable = [404, 429, 500, 503].includes(res.status) || (res.status === 400 && /think/i.test(msg));
    if (!reintentable) break; // otros errores (p. ej. clave mala): no reintentar
  }
  throw ultimoError;
}
const MAX_FUENTES = 20000;
const MAX_HISTORIAL = 12;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textoFuentes(fuentes) {
  if (!Array.isArray(fuentes) || !fuentes.length) return "";
  const porFuente = Math.floor(MAX_FUENTES / fuentes.length);
  return fuentes
    .map((f, i) => `--- FUENTE ${i + 1}: ${f.nombre || "sin nombre"} ---\n${String(f.texto || "").slice(0, porFuente)}`)
    .join("\n\n");
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo de la petición no válido" }, 400);
  }

  const { trabajo, paso, fuentes, historial, pregunta } = body || {};
  if (!paso || !pregunta) return json({ error: "Falta la pregunta o el paso" }, 400);

  const fuentesTxt = textoFuentes(fuentes);

  const sistema = `Eres un tutor universitario paciente que ayuda a un estudiante a completar UNA micro acción de su trabajo.
Trabajo: ${trabajo?.titulo || ""} (${trabajo?.asignatura || ""})
Qué hay que entregar: ${trabajo?.resumen || ""}
Micro acción actual: ${paso.accion}
Detalle: ${paso.detalle || ""}
${fuentesTxt ? `\nFuentes que ha aportado el estudiante (úsalas y cita cuál cuando sea útil):\n${fuentesTxt}` : "El estudiante no ha aportado fuentes."}

Reglas:
- Responde en español, claro y práctico, centrado en esta micro acción.
- Si pide pasos más detallados, divide la acción en 3-7 sub-pasos numerados de 2-5 minutos cada uno.
- No hagas el trabajo por él: guía, da ejemplos cortos y ayúdale a empezar.
- Texto plano, sin markdown (nada de ** ni #). Usa listas numeradas simples si hace falta.
- Sé breve: máximo unas 200 palabras salvo que pida más.`;

  const mensajes = (Array.isArray(historial) ? historial : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-MAX_HISTORIAL)
    .map((m) => ({ role: m.role, content: String(m.content) }));
  while (mensajes.length && mensajes[0].role !== "user") mensajes.shift();
  mensajes.push({ role: "user", content: String(pregunta) });

  try {
    const texto = await gemini({ sistema, mensajes, maxTokens: 4096 });
    return json({ respuesta: texto });
  } catch (err) {
    console.error(err);
    return json({ error: "No se pudo responder: " + err.message }, 500);
  }
};

export const config = { path: "/api/duda" };
