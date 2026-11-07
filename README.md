# Organizador de trabajos universitarios (Netlify + Gemini)

Subes los documentos de un trabajo (PDF, Word o TXT), su fecha de entrega y tus instrucciones. La IA (Google Gemini) lo analiza y calcula:

- **Horas estimadas** y **dificultad / carga mental** (1–5)
- Una **guía de tareas por ejercicios** (un paso por ejercicio, o por apartado si no hay ejercicios), ordenadas en fases y adaptadas a tus instrucciones y fuentes

Con esos datos la app ordena tus trabajos por **prioridad**, reparte el trabajo de cada día y te guía paso a paso.

## Funciones

- **Varios documentos por trabajo**: al crear un trabajo puedes añadir todos los que quieras (enunciado, rúbrica, apuntes, lecturas…), marcar cada uno como *Enunciado* o *Fuente* y quitar los que sobren. Dentro del trabajo puedes añadir, quitar o cambiar documentos cuando quieras.
- **Instrucciones**: cada trabajo tiene su apartado de instrucciones para la IA (qué pide el profesor, cómo quieres organizarte, en qué centrarte…). El botón **✨ Adaptar micro metas** rehace las pendientes con las instrucciones y documentos actuales y conserva las que ya has hecho.
- **Tarea resuelta (💡)**: junto al botón de dudas (❓) de cada micro meta, también en la tarjeta de la siguiente meta y en el temporizador. La IA resuelve esa micro meta completa (el texto escrito, el resumen de la lectura, el ejercicio paso a paso…) con las instrucciones, documentos y resoluciones anteriores de ese trabajo, y termina con un «Por qué» para que aprendas. Se guarda en el paso; puedes pedir otra versión, copiarla o preguntar dudas sobre ella.
- **Aislamiento**: cada petición a la IA lleva solo el enunciado, las instrucciones y las fuentes de ese trabajo. Las funciones no guardan nada, así que un trabajo nunca ve los datos de otro, ni al crear la guía ni en el chat de dudas.
- **Calendario**: vista mensual con las entregas (🏁), el plan de hoy, la previsión de los próximos días y lo que hiciste cada día. Avisa si a tu ritmo no llegas a alguna entrega.
- **Temporizador de concentración**: botón ▶ en cada micro meta, con pausa y continuar. Si lo paras, el tiempo queda guardado en el paso y sigue desde ahí. Sobrevive a recargar la página y avisa al llegar al tiempo estimado.
- **Aprende tu ritmo**: al terminar un paso con el temporizador, la app compara el tiempo real con el estimado por tipo de tarea (lectura, escritura, cálculo…). Los tiempos se ajustan a tu ritmo y la IA lo recibe para dimensionar las micro metas. Solo se guardan números, nunca el contenido de los trabajos.
- **Cuenta y sincronización (☁️)**: entras con correo y contraseña y ves lo mismo en el ordenador y en el móvil: trabajos, plan de hoy, temporizador y ritmo. Funciona sin conexión y se pone al día al volver. Si cambias el mismo trabajo en dos dispositivos a la vez, se fusionan los cambios. Ver [Cuenta y sincronización](#cuenta-y-sincronización).

## Estructura

```
├── netlify.toml                        # Configuración de Netlify
├── netlify/lib/gemini.js               # Llamada a Google Gemini en streaming
├── netlify/edge-functions/analizar.js  # Crea o adapta la guía   (/api/analizar)
├── netlify/edge-functions/duda.js      # Chat de dudas por paso  (/api/duda)
├── netlify/edge-functions/resolver.js  # Micro meta resuelta     (/api/resolver)
├── public/index.html                   # La app (interfaz, documentos, calendario, temporizador, cuenta)
├── supabase/esquema.sql                # Tabla y reglas de seguridad de la cuenta (se pega en Supabase)
└── pruebas/sincronizacion.test.mjs     # Pruebas de la sincronización: node --test pruebas/*.test.mjs
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

## Cuenta y sincronización

Usa el plan gratuito de [Supabase](https://supabase.com) para el login y para guardar los datos. El navegador habla directamente con Supabase, sin funciones de Netlify, así que **no gasta créditos de Netlify**. Sin cuenta, la app funciona igual que antes, solo en ese navegador.

### Activarla (una vez, unos 5 minutos)

1. Crea una cuenta en supabase.com y un proyecto nuevo (plan Free).
2. **SQL Editor** → pega el contenido de `supabase/esquema.sql` → **Run**. Crea la tabla y las reglas de seguridad.
3. **Authentication → Sign In / Providers → Email**: desactiva **Confirm email**. Así no hace falta ningún correo para crear la cuenta.
4. **Authentication → URL Configuration → Site URL**: pon la dirección de tu app en Netlify (por ejemplo `https://tu-app.netlify.app`).
5. **Project Settings → API Keys**: copia la **Project URL** y la **Publishable key** (`sb_publishable_…`) y ponlas en `SUPABASE_URL` y `SUPABASE_CLAVE`, al principio del script de `public/index.html`.
6. En la app pulsa **☁️ → Crear cuenta**. Los trabajos que ya tenías en ese navegador se suben a tu cuenta. En el móvil, **☁️ → Entrar** con el mismo correo.

Opcional: cuando ya tengas tu cuenta, desactiva **Allow new users to sign up** (en Authentication → Sign In / Providers) para que nadie más pueda crear cuentas en tu proyecto.

### Cómo funciona

- **Seguridad**: la Publishable key está hecha para ir en la web. Lo que protege tus datos son las reglas RLS de `esquema.sql`: cada cuenta solo puede leer y cambiar sus propias filas.
- **Qué se guarda**: cada trabajo es una fila (con sus documentos, pasos, dudas y resoluciones), y aparte el plan de hoy, el temporizador, el ritmo y las horas al día.
- **Cuándo se sincroniza**: 1,5 s después de cada cambio, al volver a la app, al recuperar internet, antes de cerrar o cambiar de app, y cada minuto con la app a la vista.
- **Sin conexión**: los cambios se guardan en el dispositivo y se suben al volver.
- **Cambios a la vez**: cada dispositivo recuerda la última versión que acordó con la nube. Si dos cambian el mismo trabajo, se fusiona campo a campo (por ejemplo, instrucciones en el PC y un paso marcado en el móvil) y no se pierde ninguno. Cada fila lleva un número de versión, así que un dispositivo nunca pisa lo que otro acaba de subir.
- **Cerrar sesión** quita los trabajos de ese dispositivo; siguen en tu cuenta y vuelven al entrar.

### Límites del plan gratis de Supabase

- 500 MB de base de datos y 5 GB de transferencia al mes: de sobra para una persona.
- **Si pasan 7 días sin usarse, el proyecto se pausa.** Se reactiva desde el panel de Supabase y los datos no se pierden; mientras tanto la app sigue funcionando en local.
- El correo de recuperar contraseña solo llega a la dirección de tu cuenta de Supabase (máximo 2 correos por hora). Usa ese mismo correo en la app.

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

- Sin cuenta, los datos se guardan solo en el navegador (localStorage). Con cuenta, se sincronizan (ver arriba).
- Los PDF escaneados (imagen sin texto) no se pueden leer; en ese caso pega el texto a mano.
