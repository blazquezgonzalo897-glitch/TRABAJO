// Resuelve UNA micro meta de un trabajo: la IA la hace completa, como quedaría bien hecha.
// Usa SOLO el enunciado, las instrucciones, las fuentes y lo ya resuelto de ese mismo trabajo.
// Edge Function con respuesta en directo (streaming): el texto aparece mientras se escribe.
import { json, textoFuentes, respuestaEnDirecto } from "../lib/gemini.js";

const MAX_ENUNCIADO = 15000;
const MAX_FUENTES = 35000;
const MAX_INSTRUCCIONES = 4000;
const MAX_ANTERIORES = 8000;

const lista = (x) => (Array.isArray(x) ? x : []);

const REGLAS = `Cómo resolverla según lo que pida:
- Si hay que escribir algo (título, introducción, párrafo, apartado, conclusión, resumen…), escribe el texto final listo para usar, con la extensión que pidan el detalle o las instrucciones.
- Si hay que leer o estudiar, da las ideas clave de la fuente indicada, ordenadas, y dónde está cada una.
- Si hay que buscar información, da los datos que aparecen en las fuentes. Si hace falta algo que no está en ellas, di qué buscar y dónde, sin inventarlo.
- Si es un cálculo, ejercicio o programa, da la solución completa paso a paso y el resultado final (o el código completo).
- Si hay que organizar o planificar, da el esquema o el plan concreto.
- Si hay que diseñar (diapositivas, gráficos…), da el contenido exacto de cada elemento.
- Si hay que revisar, aplica la revisión a lo ya resuelto de este trabajo y da la lista concreta de cambios.
- Si hay que entregar, da la lista exacta de lo que hay que comprobar y subir.

Reglas:
- Solo conoces ESTE trabajo. Usa únicamente su enunciado, sus instrucciones, sus fuentes y lo ya resuelto. Cita la fuente cuando la uses.
- No inventes citas textuales, datos, páginas ni referencias bibliográficas. Si algo no se puede saber con estos documentos, dilo en una frase.
- Respeta las instrucciones del estudiante (formato, extensión, estilo de citas, idioma…).
- Si lo ya resuelto incluye pasos anteriores, dale continuidad (mismo tema, mismo tono) sin repetirlos.
- Empieza directamente por la resolución, sin saludos ni introducciones.
- Termina con una línea en blanco y una última línea que empiece por "Por qué:" explicando en 1-2 frases cómo se ha resuelto, para que el estudiante aprenda.
- Texto plano, sin markdown (nada de ** ni #). Usa listas numeradas simples si hace falta.
- Escribe en español salvo que las instrucciones pidan otro idioma.`;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo de la petición no válido" }, 400);
  }

  const { trabajo, paso } = body || {};
  if (!paso?.accion) return json({ error: "Falta la micro meta que hay que resolver" }, 400);

  const instrucciones = String(body?.instrucciones || "").trim().slice(0, MAX_INSTRUCCIONES);
  const enunciadoTxt = textoFuentes(lista(body?.enunciados), MAX_ENUNCIADO, "DOCUMENTO DEL ENUNCIADO");
  const fuentesTxt = textoFuentes(lista(body?.fuentes), MAX_FUENTES);

  // Lo ya resuelto de este trabajo, de lo más reciente hacia atrás hasta llenar el cupo.
  let anterioresTxt = "";
  for (const a of lista(body?.anteriores).slice().reverse()) {
    const bloque = `«${String(a?.accion || "").slice(0, 200)}»:\n${String(a?.solucion || "").trim()}\n\n`;
    if (anterioresTxt.length + bloque.length > MAX_ANTERIORES) break;
    anterioresTxt = bloque + anterioresTxt;
  }

  const sistema = `Eres un tutor universitario experto. El estudiante te pide la RESOLUCIÓN de UNA micro meta de su trabajo: hazla tú, completa y bien hecha.

${REGLAS}`;

  const mensaje = `Trabajo: ${trabajo?.titulo || ""} (${trabajo?.asignatura || ""})
Qué hay que entregar: ${trabajo?.resumen || ""}

=== MICRO META QUE HAY QUE RESOLVER ===
${paso.accion}
Detalle: ${paso.detalle || "(sin detalle)"}
${paso.tipo ? `Tipo: ${paso.tipo}\n` : ""}${paso.fuente ? `Documento recomendado: ${paso.fuente}\n` : ""}
=== INSTRUCCIONES DEL ESTUDIANTE ===
${instrucciones || "(ninguna)"}
${enunciadoTxt ? `\n=== ENUNCIADO DEL TRABAJO ===\n${enunciadoTxt}\n` : ""}
${fuentesTxt ? `\n=== FUENTES DE ESTE TRABAJO ===\n${fuentesTxt}\n` : "\n(El estudiante no ha aportado fuentes para este trabajo.)\n"}
${anterioresTxt ? `\n=== YA RESUELTO EN ESTE TRABAJO ===\n${anterioresTxt}` : ""}
Resuelve ahora la micro meta «${paso.accion}».`;

  return respuestaEnDirecto({ sistema, mensajes: [{ role: "user", content: mensaje }], maxTokens: 8192 });
};

export const config = { path: "/api/resolver" };
