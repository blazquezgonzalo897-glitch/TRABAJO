// Pruebas del motor de sincronización (public/index.html, <script id="motor-sync">).
// Simulan varios dispositivos contra un Supabase falso. Ejecutar:  node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const codigo = html.match(/<script id="motor-sync">([\s\S]*?)<\/script>/)[1];
const MotorSync = new Function(codigo + "\nreturn MotorSync;")();

// ---------- Supabase falso: RLS, versión (rev) por trigger y JSON con las claves reordenadas como jsonb ----------
function servidorFalso(){
  const filas = new Map();
  const antes = [];
  let escrituras = 0;
  const comoJsonb = (v) => JSON.parse(JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(c => [c, x[c]])) : x));
  const proyectar = (f, cols) => Object.fromEntries(cols.split(",").map(c => c.trim()).map(c => [c, c === "valor" ? JSON.parse(f.valor) : f[c]]));
  function ejecutar(usuario, q){
    for (let i = antes.length - 1; i >= 0; i--) if (antes[i].si(q, usuario)){ const [g] = antes.splice(i, 1); g.hacer(); }
    if (!usuario) return { data: null, error: { code: "42501", message: "permission denied" } };
    const mias = [...filas.values()].filter(f => f.usuario === usuario);
    const pasa = (f) => q.filtros.every(([op, c, v]) => op === "eq" ? f[c] === v : v.includes(f[c]));
    if (q.op === "select") return { data: mias.filter(pasa).map(f => proyectar(f, q.cols)), error: null };
    if (q.op === "insert"){
      const v = q.valores, id = v.usuario + "|" + v.clave;
      if (v.usuario !== usuario) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
      if (filas.has(id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      const f = { usuario, clave: v.clave, valor: JSON.stringify(comoJsonb(v.valor)), rev: 1 };
      filas.set(id, f); escrituras++;
      return { data: q.devolver ? [proyectar(f, q.devolver)] : null, error: null };
    }
    const afectadas = mias.filter(pasa);
    if (q.op === "update") afectadas.forEach(f => { f.valor = JSON.stringify(comoJsonb(q.valores.valor)); f.rev++; escrituras++; });
    if (q.op === "delete") afectadas.forEach(f => { filas.delete(f.usuario + "|" + f.clave); escrituras++; });
    return { data: q.devolver ? afectadas.map(f => proyectar(f, q.devolver)) : null, error: null };
  }
  function cliente(usuario, red = { ok: true }){
    return {
      from(){
        const q = { op: "select", cols: null, valores: null, filtros: [], devolver: null };
        const api = {
          select(c){ if (q.op === "select") q.cols = c; else q.devolver = c; return api; },
          insert(v){ q.op = "insert"; q.valores = v; return api; },
          update(v){ q.op = "update"; q.valores = v; return api; },
          delete(){ q.op = "delete"; return api; },
          eq(c, v){ q.filtros.push(["eq", c, v]); return api; },
          in(c, v){ q.filtros.push(["in", c, v]); return api; },
          then(ok, mal){
            return new Promise(r => setTimeout(r, 1)).then(() => {
              if (!red.ok) return { data: null, error: { message: "TypeError: Failed to fetch" } };
              return structuredClone(ejecutar(usuario, q));
            }).then(ok, mal);
          },
        };
        return api;
      },
    };
  }
  return {
    cliente, filas,
    get escrituras(){ return escrituras; },
    valor: (usuario, clave) => { const f = filas.get(usuario + "|" + clave); return f && JSON.parse(f.valor); },
    rev: (usuario, clave) => filas.get(usuario + "|" + clave)?.rev,
    // Ejecuta hacer() justo antes de la primera consulta que cumpla si(q)
    antesDe(si, hacer){ antes.push({ si, hacer }); },
    escribirDirecto(usuario, clave, valor){ const f = filas.get(usuario + "|" + clave); f.valor = JSON.stringify(comoJsonb(valor)); f.rev++; },
  };
}

// ---------- Dispositivo falso: su almacenamiento local y su motor ----------
function dispositivo(srv, uid, inicial = {}){
  const local = new Map(Object.entries(structuredClone(inicial)));
  const red = { ok: true };
  const d = {
    local, red, ocupado: false, estado: null, escrituras: 0,
    leer: () => new Map([...local].map(([k, v]) => [k, structuredClone(v)])),
    poner(k, v){ local.set(k, structuredClone(v)); d.motor.cambio(); },
    cambiar(k, fn){ const v = structuredClone(local.get(k)); fn(v); local.set(k, v); d.motor.cambio(); },
    quitar(k){ local.delete(k); d.motor.cambio(); },
    ya: () => d.motor.ya(),
    fin: () => d.motor.parar(),
  };
  d.motor = MotorSync.crear({
    cliente: srv.cliente(uid, red), tabla: "datos_app", uid, base: MotorSync.crearBase("base-" + Math.random()),
    leer: d.leer,
    escribir: (cambios) => { d.escrituras++; cambios.forEach((v, k) => v === undefined ? local.delete(k) : local.set(k, structuredClone(v))); return true; },
    ocupado: () => d.ocupado,
    alEstado: (e) => { d.estado = e; },
  });
  return d;
}

const trabajo = (id, extra = {}) => ({
  id, titulo: "Trabajo " + id, creado: 1, fechaEntrega: "2026-12-01", instrucciones: "", color: "#2f7d6b",
  docs: [{ id: id + "-d1", nombre: "Enunciado.pdf", rol: "enunciado", texto: "Texto del enunciado" }],
  fases: ["Fase 1"],
  pasos: [
    { id: id + "-p1", accion: "Leer", hecho: false, fase: 0, chat: [] },
    { id: id + "-p2", accion: "Escribir", hecho: false, fase: 0, chat: [] },
    { id: id + "-p3", accion: "Revisar", hecho: false, fase: 0, chat: [] },
  ],
  ...extra,
});
const U = "usuario-1";

test("fusionar: cada lado cambia un campo distinto y no se pierde ninguno", () => {
  const b = trabajo("a");
  const l = structuredClone(b); l.pasos[0].hecho = true;
  const r = structuredClone(b); r.instrucciones = "APA"; r.pasos[2].hecho = true;
  const f = MotorSync.fusionar(b, l, r, false);
  assert.equal(f.instrucciones, "APA");
  assert.deepEqual(f.pasos.map(p => p.hecho), [true, false, true]);
});

test("fusionar: listas con id conservan el orden y colocan lo nuevo de la nube en su sitio", () => {
  const b = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const l = [{ id: "1" }, { id: "3" }, { id: "4" }];           // aquí se quitó el 2 y se añadió el 4
  const r = [{ id: "1" }, { id: "1b" }, { id: "2" }, { id: "3" }];   // allí se añadió 1b
  assert.deepEqual(MotorSync.fusionar(b, l, r, false).map(x => x.id), ["1", "1b", "3", "4"]);
});

test("fusionar: borrado en un lado y cambiado en el otro → se conserva el cambio", () => {
  const b = { a: 1 }, r = { a: 2 };
  assert.deepEqual(MotorSync.fusionar(b, undefined, r, false), { a: 2 });
  assert.equal(MotorSync.fusionar(b, undefined, b, false), undefined);
});

test("estable: el orden de las claves no cuenta como cambio", () => {
  assert.equal(MotorSync.estable({ b: 1, a: { d: 1, c: 2 } }), MotorSync.estable({ a: { c: 2, d: 1 }, b: 1 }));
});

test("PC con trabajos sube todo al entrar; el móvil vacío los recibe", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a"), t_b: trabajo("b"), horasDia: 4 });
  await pc.ya();
  assert.equal(pc.estado.estado, "ok");
  assert.equal(srv.filas.size, 3);
  const movil = dispositivo(srv, U);
  await movil.ya();
  assert.deepEqual(movil.local.get("t_a"), trabajo("a"));
  assert.equal(movil.local.get("horasDia"), 4);
  pc.fin(); movil.fin();
});

test("una pasada sin cambios no escribe nada (ni en la nube ni aquí)", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a", { extra: { z: 1, a: 2 } }) });
  await pc.ya();
  const movil = dispositivo(srv, U);
  await movil.ya();
  const antes = srv.escrituras, escrPc = pc.escrituras, escrMovil = movil.escrituras;
  pc.motor.cambio(); movil.motor.cambio();   // fuerza pasadas completas
  await pc.ya(); await movil.ya();
  assert.equal(srv.escrituras, antes);
  assert.equal(pc.escrituras, escrPc);
  assert.equal(movil.escrituras, escrMovil);
  pc.fin(); movil.fin();
});

test("cambios en el móvil llegan al PC; borrados también", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a"), t_b: trabajo("b") });
  await pc.ya();
  const movil = dispositivo(srv, U);
  await movil.ya();
  movil.cambiar("t_a", t => { t.pasos[0].hecho = true; t.pasos[0].hechoEn = "2026-11-07"; });
  movil.quitar("t_b");
  await movil.ya();
  await pc.ya();
  assert.equal(pc.local.get("t_a").pasos[0].hecho, true);
  assert.equal(pc.local.has("t_b"), false);
  assert.equal(srv.filas.size, 1);
  pc.fin(); movil.fin();
});

test("los dos editan el mismo trabajo sin sincronizar: se fusiona sin perder nada", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a") });
  await pc.ya();
  const movil = dispositivo(srv, U);
  await movil.ya();
  pc.cambiar("t_a", t => { t.instrucciones = "Formato APA"; });
  movil.cambiar("t_a", t => { t.pasos[1].hecho = true; });
  await pc.ya();
  await movil.ya();   // ve la versión del PC, fusiona y sube
  await pc.ya();
  for (const d of [pc, movil]){
    assert.equal(d.local.get("t_a").instrucciones, "Formato APA");
    assert.equal(d.local.get("t_a").pasos[1].hecho, true);
  }
  assert.deepEqual(srv.valor(U, "t_a").pasos.map(p => p.hecho), [false, true, false]);
  pc.fin(); movil.fin();
});

test("si otro dispositivo sube justo entre la bajada y la subida, no se pisa: se repite y se fusiona", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a") });
  await pc.ya();
  pc.cambiar("t_a", t => { t.pasos[0].hecho = true; });
  srv.antesDe((q) => q.op === "update", () => {
    const v = srv.valor(U, "t_a"); v.instrucciones = "desde el móvil"; srv.escribirDirecto(U, "t_a", v);
  });
  await pc.ya();
  assert.equal(pc.estado.estado, "ok");
  const nube = srv.valor(U, "t_a");
  assert.equal(nube.instrucciones, "desde el móvil");
  assert.equal(nube.pasos[0].hecho, true);
  assert.equal(pc.local.get("t_a").instrucciones, "desde el móvil");
  pc.fin();
});

test("borrado en el PC y cambiado en el móvil a la vez: se conserva el trabajo cambiado", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a") });
  await pc.ya();
  const movil = dispositivo(srv, U);
  await movil.ya();
  pc.quitar("t_a");
  movil.cambiar("t_a", t => { t.pasos[2].hecho = true; });
  await pc.ya();
  await movil.ya();
  await pc.ya();
  assert.equal(pc.local.get("t_a")?.pasos[2].hecho, true);
  assert.equal(srv.valor(U, "t_a")?.pasos[2].hecho, true);
  pc.fin(); movil.fin();
});

test("dos dispositivos con datos propios antes de tener cuenta: se juntan", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a"), horasDia: 4 });
  await pc.ya();
  const portatil = dispositivo(srv, U, { t_b: trabajo("b"), horasDia: 2 });
  await portatil.ya();
  await pc.ya();
  assert.deepEqual([...pc.local.keys()].sort(), ["horasDia", "t_a", "t_b"]);
  assert.deepEqual([...portatil.local.keys()].sort(), ["horasDia", "t_a", "t_b"]);
  assert.equal(portatil.local.get("horasDia"), 4);   // primera vez: manda lo que ya había en la cuenta
  pc.fin(); portatil.fin();
});

test("sin conexión: avisa, no pierde nada y sube al volver", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a") });
  await pc.ya();
  pc.red.ok = false;
  pc.cambiar("t_a", t => { t.pasos[0].hecho = true; });
  await pc.ya();
  assert.equal(pc.estado.estado, "sinconexion");
  assert.equal(srv.valor(U, "t_a").pasos[0].hecho, false);
  pc.red.ok = true;
  await pc.ya();
  assert.equal(pc.estado.estado, "ok");
  assert.equal(srv.valor(U, "t_a").pasos[0].hecho, true);
  pc.fin();
});

test("mientras la IA escribe no se tocan los datos locales; después sí", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a") });
  await pc.ya();
  const movil = dispositivo(srv, U);
  await movil.ya();
  movil.cambiar("t_a", t => { t.titulo = "Nuevo título"; });
  await movil.ya();
  pc.ocupado = true;
  pc.motor.cambio();
  await pc.ya();
  assert.equal(pc.estado.estado, "pendiente");
  assert.equal(pc.local.get("t_a").titulo, "Trabajo a");
  pc.ocupado = false;
  await pc.ya();
  assert.equal(pc.local.get("t_a").titulo, "Nuevo título");
  pc.fin(); movil.fin();
});

test("al recargar la página (motor nuevo, misma base) no se vuelve a subir nada", async () => {
  const srv = servidorFalso();
  const base = MotorSync.crearBase("recarga");
  const local = new Map([["t_a", trabajo("a")], ["planHoy", { fecha: "2026-11-07", items: [{ tid: "a", pasos: [0, 1] }] }]]);
  const motor = () => MotorSync.crear({
    cliente: srv.cliente(U), tabla: "datos_app", uid: U, base,
    leer: () => new Map([...local].map(([k, v]) => [k, structuredClone(v)])),
    escribir: () => { throw new Error("no debería escribir"); },
  });
  const m1 = motor(); await m1.ya(); m1.parar();
  const escrituras = srv.escrituras;
  const m2 = motor(); await m2.ya(); m2.parar();
  assert.equal(srv.escrituras, escrituras);
});

test("las cuentas no se mezclan", async () => {
  const srv = servidorFalso();
  const ana = dispositivo(srv, "ana", { t_a: trabajo("a") });
  await ana.ya();
  const luis = dispositivo(srv, "luis");
  await luis.ya();
  assert.equal(luis.local.size, 0);
  ana.fin(); luis.fin();
});

test("se limpian caracteres que Postgres no admite al subir", async () => {
  const srv = servidorFalso();
  const pc = dispositivo(srv, U, { t_a: trabajo("a", { resumen: "a\u0000b" }) });
  await pc.ya();
  assert.equal(srv.valor(U, "t_a").resumen, "ab");
  assert.equal(pc.local.get("t_a").resumen, "a\u0000b");   // aquí no se toca
  pc.motor.cambio();
  await pc.ya();
  assert.equal(pc.escrituras, 0);
  pc.fin();
});
