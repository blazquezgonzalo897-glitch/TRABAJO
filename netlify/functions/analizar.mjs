// Analiza un trabajo universitario con Google Gemini y crea la guía de micro acciones.
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
const MAX_CONTENIDO = 30000;
const MAX_FUENTES = 20000;

const PROMPT_SISTEMA = `Eres un asistente académico experto en planificación y en dividir trabajos grandes en micro acciones.
Recibirás el enunciado de un trabajo universitario, su fecha de entrega y, a veces, fuentes de apoyo (apuntes, lecturas, rúbricas).
Responde SOLO con un objeto JSON válido (sin markdown, sin texto extra) con esta forma exacta:
{
  "titulo": "título corto y claro del trabajo",
  "asignatura": "asignatura deducida o 'Sin especificar'",
  "resumen": "qué hay que entregar, en 1-2 frases",
  "horasEstimadas": número (horas reales de trabajo para un estudiante medio),
  "dificultad": número entero 1-5 (carga mental: 1 = mecánico, 5 = muy exigente, creativo o técnico),
  "justificacion": "por qué esas horas y esa dificultad, en 1-2 frases",
  "fases": [
    {
      "nombre": "nombre de la fase",
      "pasos": [
        { "accion": "micro acción concreta que empieza por un verbo", "detalle": "cómo hacerla exactamente", "minutos": número entre 5 y 25 }
      ]
    }
  ]
}
Reglas para las micro acciones:
- Cada paso debe poder empezarse sin pensar: concreto, pequeño y con un resultado visible (p. ej. "Abre un documento nuevo y escribe el título", no "Investiga el tema").
- Entre 10 y 20 pasos en total, repartidos en 3-5 fases ordenadas. Detalles breves (máximo 20 palabras).
- Si hay fuentes, úsalas: indica en el detalle qué fuente consultar cuando sea útil y sigue la rúbrica si la hay.
- El primer paso debe ser ridículamente fácil (menos de 5 minutos) para vencer la procrastinación.
- Incluye un paso final de revisión y otro de entrega.
- Escribe todo en español.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extraerJSON(texto) {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio === -1 || fin === -1) throw new Error("La IA no devolvió JSON");
  return JSON.parse(texto.slice(inicio, fin + 1));
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

  const { contenido, fechaEntrega, nombreArchivo, notas, fuentes } = body || {};
  if (!contenido || !fechaEntrega) {
    return json({ error: "Faltan el contenido del trabajo o la fecha de entrega" }, 400);
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const fuentesTxt = textoFuentes(fuentes);

  const mensaje = `Fecha de hoy: ${hoy}
Fecha de entrega: ${fechaEntrega}
Archivo: ${nombreArchivo || "sin nombre"}
${notas ? `Notas del estudiante: ${notas}\n` : ""}
--- ENUNCIADO DEL TRABAJO ---
${String(contenido).slice(0, MAX_CONTENIDO)}
${fuentesTxt ? `\n=== FUENTES DE APOYO ===\n${fuentesTxt}` : ""}`;

  try {
    const salida = await gemini({
      sistema: PROMPT_SISTEMA,
      mensajes: [{ role: "user", content: mensaje }],
      maxTokens: 8192,
      json: true,
    });

    const analisis = extraerJSON(salida);

    analisis.horasEstimadas = Math.max(0.5, Number(analisis.horasEstimadas) || 2);
    analisis.dificultad = Math.min(5, Math.max(1, Math.round(Number(analisis.dificultad) || 3)));
    analisis.fases = Array.isArray(analisis.fases) ? analisis.fases : [];

    return json(analisis);
  } catch (err) {
    console.error(err);
    return json({ error: "No se pudo analizar el trabajo: " + err.message }, 500);
  }
};

export const config = { path: "/api/analizar" };
