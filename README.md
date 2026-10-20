# Organizador de trabajos universitarios (Netlify + IA)

Subes el archivo de un trabajo (PDF, Word o TXT) y su fecha de entrega. La IA de Netlify (AI Gateway, con Claude) lo analiza y calcula:

- **Fecha de entrega** y días restantes
- **Horas estimadas** para completarlo
- **Dificultad / carga mental** (1–5)
- Una **guía paso a paso** dividida en fases y **micro acciones** de 5–25 minutos

Con esos datos la app ordena tus trabajos por **prioridad** y, al tocar uno, te muestra la siguiente micro acción con un botón "Hecho, siguiente".

## Estructura

```
organizador-trabajos/
├── netlify.toml                    # Configuración de Netlify
├── package.json                    # Dependencia: @anthropic-ai/sdk
├── netlify/functions/analizar.mjs  # Función que llama a la IA  (/api/analizar)
└── public/index.html               # La app (interfaz, lectura de archivos, prioridad)
```

## Desplegar

1. Sube esta carpeta a un repositorio de GitHub.
2. En Netlify: **Add new site → Import an existing project** y elige el repo.
3. Netlify detecta `netlify.toml` solo. Pulsa **Deploy**.

No hace falta configurar ninguna API key: el AI Gateway de Netlify inyecta las credenciales de Anthropic en la función automáticamente (necesitas un plan de Netlify basado en créditos; el uso de IA aparece en tu factura de Netlify).

### Probar en local

```bash
npm install -g netlify-cli
npm install
netlify link      # enlaza con tu sitio de Netlify
netlify dev       # abre http://localhost:8888
```

## Cómo se calcula la prioridad

En `public/index.html`, función `prioridad()`:

- **Presión** = horas pendientes ÷ (días restantes × horas que puedes dedicar al día). Si pasa de 1, no te da tiempo a tu ritmo.
- **Urgencia** = cuanto más cerca la entrega, más pesa.
- **Carga mental** = los trabajos difíciles suben un poco para que los empieces antes.

Las horas pendientes bajan a medida que marcas pasos como hechos, así que el orden se actualiza solo. Puedes cambiar las "horas al día" arriba de la lista.

## Personalizar

- **Modelo de IA**: variable de entorno `AI_MODEL` en Netlify (por defecto `claude-sonnet-4-6`).
- **Estilo de las micro acciones**: edita `PROMPT_SISTEMA` en `netlify/functions/analizar.mjs`.

## Limitaciones

- Los trabajos se guardan en el navegador (localStorage): no se sincronizan entre dispositivos. Para eso, el siguiente paso sería Netlify Blobs + Netlify Identity.
- Los PDF escaneados (imagen sin texto) no se pueden leer; en ese caso pega el enunciado a mano.
