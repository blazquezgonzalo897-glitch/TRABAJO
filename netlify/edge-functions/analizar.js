// Analiza UN trabajo universitario con Google Gemini y crea (o adapta) su guía de micro metas.
// Edge Function con respuesta en directo (streaming): no la corta el límite de tiempo de Netlify.
//
// Aislamiento: cada petición trae solo el enunciado, las instrucciones y las fuentes de un
// trabajo. La función no guarda nada, así que la IA nunca ve datos de otros trabajos.
import { json, textoFuentes, textoRitmo, respuestaEnDirecto, TIPOS } from "../lib/gemini.js";

const MAX_ENUNCIADO = 30000;
const MAX_FUENTES = 40000;
const MAX_INSTRUCCIONES = 4000;
const MAX_HECHOS = 60;

const PROMPT_SISTEMA = `Eres un asistente académico experto en planificación. Divides cada trabajo en tareas claras, una por ejercicio o apartado.
Recibirás UN trabajo universitario: su enunciado (uno o varios documentos), su fecha de entrega, las instrucciones del estudiante y, a veces, fuentes de apoyo (apuntes, lecturas, rúbricas).
Todo lo que recibes pertenece a este único trabajo. Usa solo esa información: no mezcles contenido de otros trabajos ni inventes fuentes.
Responde SOLO con un objeto JSON válido (sin markdown, sin texto extra) con esta forma exacta:
{
  "titulo": "título corto y claro del trabajo",
  "asignatura": "asignatura deducida o 'Sin especificar'",
  "resumen": "qué hay que entregar, en 1-2 frases",
  "horasEstimadas": número (horas reales de trabajo para un estudiante medio),
  "dificultad": número entero 1-5 (carga mental: 1 = mecánico, 5 = muy exigente, creativo o técnico),
  "justificacion": "por qué esas horas y esa dificultad, y cómo has aplicado las instrucciones, en 1-3 frases",
  "fases": [
    {
      "nombre": "nombre de la fase",
      "pasos": [
        {
          "accion": "tarea que empieza por un verbo y nombra el ejercicio o apartado (p. ej. \\"Resuelve el ejercicio 3\\")",
          "detalle": "qué pide ese ejercicio o apartado y cómo abordarlo",
          "minutos": número (lo que tardaría un estudiante medio en hacer esa tarea completa),
          "tipo": "${TIPOS.join('" | "')}",
          "fuente": "nombre EXACTO del documento a consultar en este paso (o vacío si no hace falta)"
        }
      ]
    }
  ]
}
Reglas:
- INSTRUCCIONES DEL ESTUDIANTE: tienen prioridad. Si piden un enfoque, un orden, un formato, un tamaño de paso, una extensión o un plazo, aplícalo en las micro metas. Si contradicen el enunciado, sigue el enunciado y explícalo en la justificación.
- FUENTES: basa los pasos en ellas. Cuando un paso deba usar una fuente, pon su nombre exacto en "fuente" y di en el detalle qué parte mirar (tema, apartado, página…) si se puede deducir. Si hay rúbrica o criterios de evaluación, cubre cada criterio con algún paso.
- DIVIDE POR EJERCICIOS, NO EN MIGAS: cada paso es un ejercicio completo del enunciado ("Resuelve el ejercicio 2", "Responde la pregunta 4"). Si el trabajo no tiene ejercicios (ensayo, informe, presentación, proyecto), cada paso es un apartado o sección completa del entregable ("Escribe la introducción", "Haz las diapositivas de resultados").
- NO dividas un ejercicio o apartado en trozos pequeños (nada de "abre el documento", "escribe el título", "lee el enunciado", "subraya"). Solo si un ejercicio por sí solo llevaría más de 90 minutos, divídelo por sus apartados reales (a, b, c…), nunca en acciones mecánicas.
- Añade un paso previo de preparación (leer o estudiar algo) solo si hace falta de verdad para poder hacer los ejercicios, y como un único paso.
- Los ejercicios o apartados muy cortos y del mismo tipo (menos de 10 minutos cada uno) se agrupan en un solo paso ("Responde las preguntas 1 a 5").
- Número de pasos: el que salga de los ejercicios o apartados del trabajo, normalmente entre 3 y 20. Agrúpalos en 2-5 fases (p. ej. "Preparación", "Ejercicios 1-4", "Ejercicios 5-8", "Revisión y entrega"); si son pocos, basta con 2 fases.
- Cada paso indica en el detalle qué pide ese ejercicio y cómo abordarlo, de forma concreta. Detalles breves (máximo 30 palabras).
- "tipo" clasifica el paso: lectura (leer o estudiar), investigacion (buscar información), organizacion (esquemas, planificar), escritura (redactar), calculo (problemas, ejercicios), programacion (código), diseno (diapositivas, gráficos, maquetar), revision (revisar o corregir), entrega (subir, imprimir, enviar), otro.
- Si se indica el RITMO del estudiante: "minutos" sigue siendo el tiempo de un estudiante medio (la app aplica su ritmo después). No dividas más los pasos por el ritmo; úsalo solo para estimar bien.
- Termina con un único paso de "Revisa y entrega" (revisar todo y subirlo).
- Si las INSTRUCCIONES piden otro tamaño de paso (más pequeños o más grandes), haz caso a las instrucciones.
- Escribe todo en español.`;

const lista = (x) => (Array.isArray(x) ? x : []);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo de la petición no válido" }, 400);
  }

  const { fechaEntrega, ritmo, modo } = body || {};
  // Formato actual: enunciados[] + fuentes[] + instrucciones. Se acepta también el antiguo (contenido + notas).
  const enunciados = lista(body?.enunciados).filter((d) => String(d?.texto || "").trim());
  if (!enunciados.length && body?.contenido) enunciados.push({ nombre: body.nombreArchivo || "Enunciado", texto: body.contenido });
  const fuentes = lista(body?.fuentes).filter((d) => String(d?.texto || "").trim());
  const instrucciones = String(body?.instrucciones ?? body?.notas ?? "").trim().slice(0, MAX_INSTRUCCIONES);
  const adaptar = modo === "adaptar";
  const hechos = lista(body?.hechos).map((h) => String(h || "").trim().slice(0, 200)).filter(Boolean).slice(0, MAX_HECHOS);

  if (!enunciados.length || !fechaEntrega) {
    return json({ error: "Faltan el enunciado del trabajo o la fecha de entrega" }, 400);
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const ritmoTxt = textoRitmo(ritmo);
  const fuentesTxt = textoFuentes(fuentes, MAX_FUENTES);
  const nombres = [...enunciados, ...fuentes].map((d) => `«${String(d.nombre || "sin nombre").slice(0, 200)}»`).join(", ");

  let mensaje = `Fecha de hoy: ${hoy}
Fecha de entrega: ${fechaEntrega}
Documentos de este trabajo (los únicos que puedes citar en "fuente"): ${nombres}

=== INSTRUCCIONES DEL ESTUDIANTE ===
${instrucciones || "(no ha escrito instrucciones)"}
${ritmoTxt ? `\n=== RITMO DEL ESTUDIANTE ===\n${ritmoTxt}\n` : ""}
=== ENUNCIADO DEL TRABAJO ===
${textoFuentes(enunciados, MAX_ENUNCIADO, "DOCUMENTO DEL ENUNCIADO")}
${fuentesTxt ? `\n=== FUENTES DE APOYO ===\n${fuentesTxt}` : ""}`;

  if (adaptar) {
    mensaje += `

=== MODO ADAPTAR ===
El estudiante ya ha empezado. Crea SOLO las tareas que faltan, divididas por ejercicios o apartados y adaptadas a las instrucciones y fuentes de arriba. Si un ejercicio quedó a medias, crea un paso para terminarlo.
${hechos.length ? `Pasos ya completados (no los repitas, continúa desde aquí):\n${hechos.map((h, i) => `${i + 1}. ${h}`).join("\n")}` : "Aún no ha completado ningún paso."}
En este modo "horasEstimadas" son las horas que FALTAN.`;
  } else {
    mensaje += `

Si el orden da igual, empieza por el ejercicio o apartado más sencillo, para arrancar con buen pie.`;
  }

  return respuestaEnDirecto({
    sistema: PROMPT_SISTEMA,
    mensajes: [{ role: "user", content: mensaje }],
    maxTokens: 12000,
    json: true,
  });
};

export const config = { path: "/api/analizar" };
