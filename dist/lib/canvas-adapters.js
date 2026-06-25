function isCanvasFramework(value) {
    return (value === "konva" ||
        value === "fabric" ||
        value === "pixi" ||
        value === "phaser" ||
        value === "three" ||
        value === "babylon" ||
        value === "a11y" ||
        value === "vision" ||
        value === "unknown");
}
/** A rect normalizes only when all four components are finite numbers. */
function parseRect(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const r = raw;
    const x = Number(r.x);
    const y = Number(r.y);
    const width = Number(r.width);
    const height = Number(r.height);
    if (![x, y, width, height].every(Number.isFinite))
        return undefined;
    return { x, y, width, height };
}
/**
 * Normalize a canvas bridge dump into tap-ready `CanvasObject[]`.
 *
 * Modeled on engine.ts#parseEngineObjects: accept a value OR a JSON string;
 * non-array input → `[]`; drop any node lacking finite numeric `x` AND `y`
 * (untappable without vision). Optional fields (`text`/`role`/`type`/`visible`/
 * `interactable`/`id`/`bbox`) are carried through ONLY when present and
 * well-typed, so the result compares exactly. Every surviving node is stamped
 * `source: "scene-graph"`, plus `framework` when the dump names one.
 */
export function parseCanvasObjects(raw) {
    let arr = raw;
    if (typeof raw === "string") {
        try {
            arr = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(arr))
        return [];
    return arr.flatMap((o) => {
        if (!o || typeof o !== "object")
            return [];
        const rec = o;
        const x = Number(rec.x);
        const y = Number(rec.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return [];
        const idIsString = typeof rec.id === "string";
        const idIsNumber = typeof rec.id === "number" && Number.isFinite(rec.id);
        const bbox = parseRect(rec.bbox);
        const obj = {
            name: typeof rec.name === "string" ? rec.name : "",
            x,
            y,
            ...(idIsString ? { id: rec.id } : idIsNumber ? { id: rec.id } : {}),
            ...(typeof rec.type === "string" ? { type: rec.type } : {}),
            ...(typeof rec.text === "string" ? { text: rec.text } : {}),
            ...(typeof rec.role === "string" ? { role: rec.role } : {}),
            ...(bbox ? { bbox } : {}),
            ...(typeof rec.visible === "boolean" ? { visible: rec.visible } : {}),
            ...(typeof rec.interactable === "boolean" ? { interactable: rec.interactable } : {}),
            ...(isCanvasFramework(rec.framework) ? { framework: rec.framework } : {}),
            source: "scene-graph",
        };
        return [obj];
    });
}
/**
 * A tiny JS expression (string) that evaluates, in a page where the bridge is
 * installed, to the detected framework name — handy for callers that just want
 * to log which adapter fired without a full inspect round-trip.
 */
export function detectFrameworkExpression() {
    return `(window.__podiumCanvas&&window.__podiumCanvas.framework)||"unknown"`;
}
/**
 * The bridge body, authored as plain JS (no TS syntax, so it needs no transpile
 * before eval). Installs `window.__podiumCanvas` with `inspect`, `hitTest`,
 * `objectRect`, and a cached `framework`.
 *
 * Geometry contract: every reported `x`/`y`/`bbox` is in CSS px relative to the
 * canvas element top-left. For 2D backing-store coords we multiply by
 * `rect.width / canvas.width` (CSS size ÷ backing-store size, i.e. 1/DPR on a
 * HiDPI canvas); for 3D we project NDC→CSS px against the canvas client rect.
 * Each adapter returns `null` when ITS framework is absent and an array (maybe
 * empty) when it fires, so `detect()` can pick the first that matches.
 */
const BRIDGE_BODY = String.raw `
function finite(n) { return typeof n === "number" && isFinite(n); }

// Locate the canvas a framework renders into so world/backing-store coords map
// onto CSS px. Prefer an explicit view/canvas; else the largest <canvas>.
function resolveCanvas(hint) {
  if (hint && hint.getBoundingClientRect) return hint;
  var list = document.getElementsByTagName("canvas");
  var best = null, bestArea = -1;
  for (var i = 0; i < list.length; i++) {
    var area = list[i].width * list[i].height;
    if (area > bestArea) { bestArea = area; best = list[i]; }
  }
  return best;
}

// Backing-store px -> CSS px relative to canvas top-left. On a HiDPI canvas
// canvas.width is DPR*cssWidth, so the scale below works out to ~1/DPR.
function makeScaler(canvas) {
  var rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  var bw = canvas && canvas.width ? canvas.width : (rect.width || 1);
  var bh = canvas && canvas.height ? canvas.height : (rect.height || 1);
  var sx = (rect.width || bw) / (bw || 1);
  var sy = (rect.height || bh) / (bh || 1);
  return {
    rect: rect,
    css: function (x, y) { return { x: x * sx, y: y * sy }; },
    scaleW: function (v) { return v * sx; },
    scaleH: function (v) { return v * sy; }
  };
}

function rectFrom(x, y, width, height) { return { x: x, y: y, width: width, height: height }; }
function centerOf(r) { return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
function clsName(o) { try { return (o.constructor && o.constructor.name) || ""; } catch (e) { return ""; } }

// ---- Pixi ---------------------------------------------------------------
function pixiApp() {
  return (typeof globalThis !== "undefined" && globalThis.__PIXI_APP__) ||
    window.__PIXI_APP__ || window.app ||
    (window.PIXI && window.PIXI.__app) || null;
}
function inspectPixi() {
  var app = pixiApp();
  if (!app || !app.stage) return null;
  var renderer = app.renderer || {};
  var canvas = resolveCanvas(app.canvas || renderer.view || renderer.canvas);
  var s = makeScaler(canvas);
  var out = [];
  function walk(node) {
    if (!node) return;
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i], b = null;
      try { b = child.getBounds(); } catch (e) { b = null; }
      if (b && finite(b.x) && finite(b.y)) {
        var tl = s.css(b.x, b.y);
        var bbox = rectFrom(tl.x, tl.y, s.scaleW(b.width || 0), s.scaleH(b.height || 0));
        var c = centerOf(bbox);
        var o = {
          name: String(child.label || child.name || ""),
          type: "PIXI." + (clsName(child) || "Container"),
          x: c.x, y: c.y, bbox: bbox,
          visible: child.visible !== false,
          interactable: child.eventMode ? child.eventMode !== "none" : !!child.interactive
        };
        if (typeof child.text === "string") o.text = child.text;
        out.push(o);
      }
      walk(child);
    }
  }
  walk(app.stage);
  return out;
}

// ---- Konva --------------------------------------------------------------
function konvaStage() {
  if (window.__KONVA_STAGE__) return window.__KONVA_STAGE__;
  if (window.stage && window.stage.find) return window.stage;
  if (window.Konva && window.Konva.stages && window.Konva.stages.length) return window.Konva.stages[0];
  return null;
}
function inspectKonva() {
  var stage = konvaStage();
  if (!stage || !stage.find) return null;
  var content = stage.content;
  var el = content && content.getElementsByTagName ? content.getElementsByTagName("canvas")[0] : null;
  var s = makeScaler(resolveCanvas(el));
  var out = [];
  var nodes = stage.find("*") || [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i], r = null;
    try { r = n.getClientRect(); } catch (e) { r = null; }
    if (r && finite(r.x) && finite(r.y)) {
      var tl = s.css(r.x, r.y);
      var bbox = rectFrom(tl.x, tl.y, s.scaleW(r.width || 0), s.scaleH(r.height || 0));
      var c = centerOf(bbox);
      var o = {
        name: String((n.name && n.name()) || (n.id && n.id()) || ""),
        type: "Konva." + String((n.getClassName && n.getClassName()) || "Node"),
        x: c.x, y: c.y, bbox: bbox,
        visible: n.isVisible ? n.isVisible() !== false : true,
        interactable: n.isListening ? n.isListening() !== false : true
      };
      if (typeof n._id === "number") o.id = n._id;
      if (typeof n.text === "function") { try { var t = n.text(); if (typeof t === "string") o.text = t; } catch (e) {} }
      out.push(o);
    }
  }
  return out;
}

// ---- Fabric -------------------------------------------------------------
function fabricCanvas() {
  if (window.__FABRIC_CANVAS__) return window.__FABRIC_CANVAS__;
  if (window.canvas && window.canvas.getObjects) return window.canvas;
  return null;
}
function inspectFabric() {
  var fc = fabricCanvas();
  if (!fc || !fc.getObjects) return null;
  var el = (fc.getElement && fc.getElement()) || fc.lowerCanvasEl;
  var s = makeScaler(resolveCanvas(el));
  var out = [];
  var objs = fc.getObjects() || [];
  for (var i = 0; i < objs.length; i++) {
    var ob = objs[i], r = null;
    try { r = ob.getBoundingRect(true, true); } catch (e) { r = null; }
    if (r && finite(r.left) && finite(r.top)) {
      var tl = s.css(r.left, r.top);
      var bbox = rectFrom(tl.x, tl.y, s.scaleW(r.width || 0), s.scaleH(r.height || 0));
      var c = centerOf(bbox);
      var o = {
        name: String(ob.name || ob.id || ""),
        type: "Fabric." + String(ob.type || "Object"),
        x: c.x, y: c.y, bbox: bbox,
        visible: ob.visible !== false,
        interactable: ob.selectable !== false || ob.evented !== false
      };
      if (typeof ob.text === "string") o.text = ob.text;
      out.push(o);
    }
  }
  return out;
}

// ---- Phaser -------------------------------------------------------------
function phaserGame() { return window.game || window.__PHASER_GAME__ || null; }
function phaserScene() {
  var game = phaserGame();
  if (!game || !game.scene) return null;
  var scenes = game.scene.scenes || [];
  for (var i = 0; i < scenes.length; i++) {
    var sys = scenes[i].sys;
    if (sys && sys.settings && sys.settings.active) return scenes[i];
  }
  return scenes.length ? scenes[0] : null;
}
function inspectPhaser() {
  var scene = phaserScene();
  if (!scene || !scene.children) return null;
  var game = phaserGame();
  var s = makeScaler(resolveCanvas(game && game.canvas));
  var out = [];
  var list = (scene.children && scene.children.list) || [];
  for (var i = 0; i < list.length; i++) {
    var ob = list[i], b = null;
    try { b = ob.getBounds(); } catch (e) { b = null; }
    if (b && finite(b.x) && finite(b.y)) {
      var tl = s.css(b.x, b.y);
      var bbox = rectFrom(tl.x, tl.y, s.scaleW(b.width || 0), s.scaleH(b.height || 0));
      var c = centerOf(bbox);
      var o = {
        name: String(ob.name || ""),
        type: "Phaser." + String(ob.type || clsName(ob) || "GameObject"),
        x: c.x, y: c.y, bbox: bbox,
        visible: ob.visible !== false,
        interactable: !!ob.input
      };
      if (typeof ob.text === "string") o.text = ob.text;
      out.push(o);
    }
  }
  return out;
}

// ---- Three --------------------------------------------------------------
function inspectThree() {
  var scene = window.scene, camera = window.camera;
  if (!scene || !camera || typeof scene.traverse !== "function") return null;
  var renderer = window.renderer;
  var s = makeScaler(resolveCanvas(renderer && renderer.domElement));
  var rect = s.rect, THREE = window.THREE, out = [];
  scene.traverse(function (n) {
    if (!n.name && !n.isMesh) return;
    try {
      var v = THREE && THREE.Vector3 ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };
      if (n.getWorldPosition && v.set) { n.getWorldPosition(v); }
      else if (n.position) { v = { x: n.position.x, y: n.position.y, z: n.position.z, project: n.position.project }; }
      if (v.project) { v.project(camera); }
      var ndcX = Number(v.x), ndcY = Number(v.y);
      if (!finite(ndcX) || !finite(ndcY)) return;
      var cx = ((ndcX + 1) / 2) * (rect.width || 0);   // NDC (-1..1) -> CSS px
      var cy = ((1 - ndcY) / 2) * (rect.height || 0);
      out.push({
        name: String(n.name || ""),
        type: String(n.type || "Object3D"),
        x: cx, y: cy,
        visible: n.visible !== false,
        interactable: !!n.name
      });
    } catch (e) { /* skip un-projectable node */ }
  });
  return out;
}

// ---- Babylon ------------------------------------------------------------
function inspectBabylon() {
  var scene = window.scene, engine = window.engine, BABYLON = window.BABYLON;
  if (!scene || !engine || !BABYLON || typeof scene.getMeshByName !== "function") return null;
  var canvas = resolveCanvas(engine.getRenderingCanvas && engine.getRenderingCanvas());
  var s = makeScaler(canvas);
  var rect = s.rect, meshes = scene.meshes || [], out = [];
  for (var i = 0; i < meshes.length; i++) {
    var m = meshes[i];
    try {
      var pos = m.getAbsolutePosition && m.getAbsolutePosition();
      var coords = BABYLON.Vector3.Project(
        pos,
        BABYLON.Matrix.Identity(),
        scene.getTransformMatrix(),
        { x: 0, y: 0, width: rect.width || 0, height: rect.height || 0 }
      );
      if (!coords || !finite(coords.x) || !finite(coords.y)) continue;
      out.push({
        name: String(m.name || ""),
        type: "Mesh",
        x: coords.x, y: coords.y,
        visible: m.isVisible !== false,
        interactable: !!m.isPickable
      });
    } catch (e) { /* skip */ }
  }
  return out;
}

// ---- Detection + dispatch ----------------------------------------------
var ADAPTERS = [
  { name: "pixi", run: inspectPixi },
  { name: "konva", run: inspectKonva },
  { name: "fabric", run: inspectFabric },
  { name: "phaser", run: inspectPhaser },
  { name: "three", run: inspectThree },
  { name: "babylon", run: inspectBabylon }
];

function detect() {
  for (var i = 0; i < ADAPTERS.length; i++) {
    try {
      var objs = ADAPTERS[i].run();   // null = framework absent; array = it fired
      if (objs !== null && objs !== undefined) return { framework: ADAPTERS[i].name, objects: objs };
    } catch (e) { /* try the next adapter */ }
  }
  return { framework: "unknown", objects: [] };
}

function matches(o, kind, value) {
  if (kind === "id") return String(o.id) === value;
  if (kind === "text") return (o.text || "").indexOf(value) >= 0;
  if (kind === "type") return (o.type || "").indexOf(value) >= 0;
  if (kind === "role") return o.role === value;
  return o.name === value;   // "name" / "path" / default
}

var api = {
  framework: "unknown",
  inspect: function (selectorKind, value) {
    var res = detect();
    api.framework = res.framework;
    var objects = res.objects;
    if (selectorKind && typeof value === "string") {
      objects = objects.filter(function (o) { return matches(o, selectorKind, value); });
    }
    return { framework: res.framework, objects: objects };
  },
  hitTest: function (x, y) {
    var res = detect();
    api.framework = res.framework;
    var hit = null;
    for (var i = 0; i < res.objects.length; i++) {
      var b = res.objects[i].bbox;
      if (b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) hit = res.objects[i];
    }
    return hit;   // last match wins => topmost in paint order
  },
  objectRect: function (name) {
    var res = detect();
    api.framework = res.framework;
    for (var i = 0; i < res.objects.length; i++) {
      if (res.objects[i].name === name) return res.objects[i].bbox || null;
    }
    return null;
  }
};

window.__podiumCanvas = api;
return api;
`;
/**
 * Build the self-contained bridge IIFE installed in the WebView page.
 *
 * Returns ONE JS string (no external references) that, when eval'd, defines
 * `window.__podiumCanvas`. The body is wrapped in try/catch so any
 * detection/install failure yields a degraded-but-usable stub instead of
 * throwing across the eval boundary (fail closed).
 */
export function buildCanvasBridgeScript() {
    return (";(function(){try{" +
        BRIDGE_BODY +
        "}catch(e){try{window.__podiumCanvas={framework:'unknown'," +
        "inspect:function(){return {framework:'unknown',objects:[]};}," +
        "hitTest:function(){return null;},objectRect:function(){return null;}};}catch(_){}" +
        "return window.__podiumCanvas;}})();");
}
