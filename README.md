# Organizador de trabajos universitarios (Netlify + Gemini)

Subes los documentos de un trabajo (PDF, Word o TXT), su fecha de entrega y tus instrucciones. La IA (Google Gemini) lo analiza y calcula:

- **Horas estimadas** y **dificultad / carga mental** (1–5)
- Una **guía de micro metas** de 5–25 minutos, ordenadas en fases, adaptadas a tus instrucciones y fuentes

Con esos datos la app ordena tus trabajos por **prioridad**, reparte el trabajo de cada día y te guía paso a paso.

## Funciones

- **Varios documentos por trabajo**: al crear un trabajo puedes añadir todos los que quieras (enunciado, rúbrica, apuntes, lecturas…), marcar cada uno como *Enunciado* o *Fuente* y quitar los que sobren. Dentro del trabajo puedes añadir, quitar o cambiar documentos cuando quieras.
- **Instrucciones**: cada trabajo tiene su apartado de instrucciones para la IA (qué pide el profesor, cómo quieres organizarte, en qué centrarte…). El botón **✨ Adaptar micro metas** rehace las pendientes con las instrucciones y documentos actuales y conserva las que ya has hecho.
- **Tarea resuelta (💡)**: junto al botón de dudas (❓) de cada micro meta, también en la tarjeta de la siguiente meta y en el temporizador. La IA resuelve esa micro meta completa (el texto escrito, el resumen de la lectura, el ejercicio paso a paso…) con las instrucciones, documentos y resoluciones anteriores de ese trabajo, y termina con un «Por qué» para que aprendas. Se guarda en el paso; puedes pedir otra versión, copiarla o preguntar dudas sobre ella.
- **Aislamiento**: cada petición a la IA lleva solo el enunciado, las instrucciones y las fuentes de ese trabajo. Las funciones no guardan nada, así que un trabajo nunca ve los datos de otro, ni al crear la guía ni en el chat de dudas.
- **Calendario**: vista mensual con las entregas (🏁), el plan de hoy, la previsión de los próximos días y lo que hiciste cada día. Avisa si a tu ritmo no llegas a alguna entrega.
- **Temporizador de concentración**: botón ▶ en cada micro meta, con pausa y continuar. Si lo paras, el tiempo queda guardado en el paso y sigue desde ahí. Sobrevive a recargar la página y avisa al llegar al tiempo estimado.
- **Aprende tu ritmo**: al terminar un paso con el temporizador, la app compara el tiempo real con el estimado por tipo de tarea (lectura, escritura, cálculo…). Los tiempos se ajustan a tu ritmo y la IA lo recibe para dimensionar las micro metas. Solo se guardan números, nunca el contenido de los trabajos.

## Estructura

```
├── netlify.toml                        # Configuración de Netlify
├── netlify/lib/gemini.js               # Llamada a Google Gemini en streaming
├── netlify/edge-functions/analizar.js  # Crea o adapta la guía   (/api/analizar)
├── netlify/edge-functions/duda.js      # Chat de dudas por paso  (/api/duda)
├── netlify/edge-functions/resolver.js  # Micro meta resuelta     (/api/resolver)
└── public/index.html                   # La app (interfaz, documentos, calendario, temporizador)
```

Las llamadas a la IA son Edge Functions con respuesta en directo (streaming): el texto llega poco a poco, así que no las corta el límite de tiempo de las funciones normales.

## Desplegar

1. En Netlify: **Add new site → Import an existing project** y elige este repo.
2. En **Site configuration → Environment variables** crea `GEMINI_API_KEY` con tu clave de Google AI Studio.
3. Opcional: `GEMINI_MODEL` para cambiar el modelo principal.

Cada push a `main` se despliega solo.

### Probar en local

```bash
npm install -g netlify-cli
netlify link      # enlaza con tu sitio de Netlify
netlify dev       # abre http://localhost:8888
```

## Cómo se calcula la prioridad

En `public/index.html`, función `prioridadCon()`:

- **Presión** = horas pendientes (a tu ritmo) ÷ (días restantes × horas que puedes dedicar al día). Si pasa de 1, no te da tiempo.
- **Urgencia** = cuanto más cerca la entrega, más pesa.
- **Carga mental** = los trabajos difíciles suben un poco para que los empieces antes.

El plan de hoy y la previsión del calendario usan el mismo reparto (`repartir()`): primero lo mínimo de cada trabajo para llegar a tiempo y después el tiempo que sobra para lo más prioritario.

## Personalizar

- **Estilo de las micro metas**: `PROMPT_SISTEMA` en `netlify/edge-functions/analizar.js`.
- **Comportamiento del tutor**: el texto `sistema` en `netlify/edge-functions/duda.js`.
- **Cómo resuelve las micro metas**: `REGLAS` en `netlify/edge-functions/resolver.js`.

## Limitaciones

- Los datos se guardan en el navegador (localStorage): no se sincronizan entre dispositivos. Para eso, el siguiente paso sería Netlify Blobs + Netlify Identity.
- Los PDF escaneados (imagen sin texto) no se pueden leer; en ese caso pega el texto a mano.
