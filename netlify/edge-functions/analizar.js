// Analiza un trabajo universitario con Google Gemini y crea la guía de micro acciones.
// Edge Function con respuesta en directo (streaming): no la corta el límite de tiempo de Netlify.
import { json, textoFuentes, respuestaEnDirecto } from "../lib/gemini.js";

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
  const fuentesTxt = textoFuentes(fuentes, MAX_FUENTES);

  const mensaje = `Fecha de hoy: ${hoy}
Fecha de entrega: ${fechaEntrega}
Archivo: ${nombreArchivo || "sin nombre"}
${notas ? `Notas del estudiante: ${notas}\n` : ""}
--- ENUNCIADO DEL TRABAJO ---
${String(contenido).slice(0, MAX_CONTENIDO)}
${fuentesTxt ? `\n=== FUENTES DE APOYO ===\n${fuentesTxt}` : ""}`;

  return respuestaEnDirecto({
    sistema: PROMPT_SISTEMA,
    mensajes: [{ role: "user", content: mensaje }],
    maxTokens: 8192,
    json: true,
  });
};

export const config = { path: "/api/analizar" };
