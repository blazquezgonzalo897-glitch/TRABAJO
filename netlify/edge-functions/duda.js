// Responde dudas sobre una micro meta concreta de un trabajo (chat), usando SOLO el enunciado,
// las instrucciones y las fuentes de ese trabajo.
// Edge Function con respuesta en directo (streaming): el texto aparece mientras se escribe.
import { json, textoFuentes, respuestaEnDirecto } from "../lib/gemini.js";

const MAX_ENUNCIADO = 12000;
const MAX_FUENTES = 25000;
const MAX_INSTRUCCIONES = 4000;
const MAX_HISTORIAL = 12;

const lista = (x) => (Array.isArray(x) ? x : []);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo de la petición no válido" }, 400);
  }

  const { trabajo, paso, historial, pregunta } = body || {};
  if (!paso || !pregunta) return json({ error: "Falta la pregunta o el paso" }, 400);

  const instrucciones = String(body?.instrucciones || "").trim().slice(0, MAX_INSTRUCCIONES);
  const enunciadoTxt = textoFuentes(lista(body?.enunciados), MAX_ENUNCIADO, "DOCUMENTO DEL ENUNCIADO");
  const fuentesTxt = textoFuentes(lista(body?.fuentes), MAX_FUENTES);

  const sistema = `Eres un tutor universitario paciente que ayuda a un estudiante a completar UNA micro meta de su trabajo.
Trabajo: ${trabajo?.titulo || ""} (${trabajo?.asignatura || ""})
Qué hay que entregar: ${trabajo?.resumen || ""}
Micro meta actual: ${paso.accion}
Detalle: ${paso.detalle || ""}
${paso.fuente ? `Documento recomendado para este paso: ${paso.fuente}\n` : ""}
Instrucciones del estudiante para este trabajo: ${instrucciones || "(ninguna)"}
${enunciadoTxt ? `\nEnunciado del trabajo:\n${enunciadoTxt}\n` : ""}
${fuentesTxt ? `\nFuentes que ha aportado el estudiante para este trabajo (úsalas y cita cuál cuando sea útil):\n${fuentesTxt}` : "El estudiante no ha aportado fuentes para este trabajo."}

Reglas:
- Solo conoces ESTE trabajo. Usa únicamente su enunciado, sus instrucciones y sus fuentes. Si te preguntan por otro trabajo o por algo que no está en estos documentos, dilo claramente en lugar de inventarlo.
- Respeta las instrucciones del estudiante.
- Responde en español, claro y práctico, centrado en esta micro meta.
- Si pide pasos más detallados, divide la meta en 3-7 sub-pasos numerados de 2-5 minutos cada uno.
- No hagas el trabajo por él: guía, da ejemplos cortos y ayúdale a empezar.
- Texto plano, sin markdown (nada de ** ni #). Usa listas numeradas simples si hace falta.
- Sé breve: máximo unas 200 palabras salvo que pida más.`;

  const mensajes = lista(historial)
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-MAX_HISTORIAL)
    .map((m) => ({ role: m.role, content: String(m.content) }));
  while (mensajes.length && mensajes[0].role !== "user") mensajes.shift();
  mensajes.push({ role: "user", content: String(pregunta) });

  return respuestaEnDirecto({ sistema, mensajes, maxTokens: 4096 });
};

export const config = { path: "/api/duda" };
