// Guion del Navegador de NÚCLEO. Se inyecta en todos los marcos de cada página, antes que sus guiones.
//
// NÚCLEO le habla a la página con `window.__nucleoWeb.run(orden)` (solo en el marco principal) y
// recoge el resultado con `size`/`part`/`done`. Los marcos de otro origen se leen por mensajes entre
// ventanas: cada marco contesta con su propio texto y sus propios controles.
//
// La clave de un ingreso solo la recibe un documento del sitio guardado en el acceso: el marco
// principal comprueba su propio host, y a un marco se le envía con el origen exacto como destino.
(function () {
  "use strict";
  if (window.__nucleoWebLoaded) return;
  try {
    Object.defineProperty(window, "__nucleoWebLoaded", { value: true });
  } catch (e) {
    return;
  }

  var K = "__nucleo_web__";
  var TOP = false;
  try {
    TOP = window.top === window;
  } catch (e) {}
  var MAX_TEXT = 200000;
  var MAX_CONTROLS = 400;
  var MAX_FILE = 25 * 1024 * 1024;
  // Los controles conservan su número mientras dure el documento: así, después de una acción,
  // NÚCLEO puede informar solo lo que cambió. `DOC` distingue este documento del que lo reemplace
  // en el mismo marco.
  var DOC = Math.random().toString(36).slice(2, 10);
  var els = []; // número local → WeakRef del elemento
  var known = typeof WeakMap === "function" ? new WeakMap() : null;
  var alerts = []; // avisos (alert) que mostró la página desde la última lectura

  function refOf(el) {
    var n = known ? known.get(el) : undefined;
    if (n === undefined) {
      n = els.length;
      els.push(typeof WeakRef === "function" ? new WeakRef(el) : { deref: function () { return el; } });
      if (known) known.set(el, n);
    }
    return n;
  }
  function elAt(n) {
    var r = els[n];
    return r ? r.deref() : null;
  }

  // Un `alert` nativo detiene la página hasta que alguien lo cierra y el agente no lo ve. Es solo un
  // aviso: se muestra en una franja dentro de la página y queda anotado para la próxima lectura.
  // `confirm` y `prompt` no se tocan: son decisiones de la persona.
  try {
    window.alert = function (m) {
      var t = clean(m, 400);
      if (!t) return;
      alerts.push(t);
      if (alerts.length > 5) alerts.shift();
      try {
        var b = document.createElement("div");
        b.textContent = "Aviso de la página: " + t + "  ✕";
        b.setAttribute("role", "alert");
        b.style.cssText =
          "position:fixed;z-index:2147483647;top:8px;left:50%;transform:translateX(-50%);max-width:min(720px,92vw);" +
          "background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:8px;" +
          "box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;white-space:pre-wrap";
        b.addEventListener("click", function () {
          b.remove();
        });
        (document.body || document.documentElement).appendChild(b);
        setTimeout(function () {
          b.remove();
        }, 15000);
      } catch (e) {}
    };
  } catch (e) {}

  function clean(s, n) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return n && s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var st = window.getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none";
  }

  function labelOf(el) {
    var t = el.getAttribute("aria-label") || "";
    if (!t && el.id) {
      try {
        var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l) t = l.innerText;
      } catch (e) {}
    }
    if (!t && el.closest) {
      var wrap = el.closest("label");
      if (wrap) t = wrap.innerText;
    }
    if (!t) t = el.innerText || "";
    if (!clean(t)) t = el.getAttribute("placeholder") || el.getAttribute("title") || "";
    if (!clean(t) && (el.type === "submit" || el.type === "button")) t = el.value || "";
    if (!clean(t)) {
      var img = el.querySelector && el.querySelector("img[alt]");
      if (img) t = img.getAttribute("alt");
    }
    if (!clean(t)) t = el.getAttribute("name") || el.id || "";
    return clean(t, 90);
  }

  function kindOf(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "a") return "enlace";
    if (tag === "select") return "lista";
    if (tag === "textarea") return "campo";
    if (tag === "iframe" || tag === "embed" || tag === "object") return "documento";
    if (tag === "input") {
      var t = (el.type || "text").toLowerCase();
      if (t === "checkbox" || t === "radio") return "casilla";
      if (t === "submit" || t === "button" || t === "image" || t === "reset") return "botón";
      if (t === "password") return "clave";
      if (t === "file") return "archivo";
      return "campo";
    }
    var role = el.getAttribute("role");
    if (role === "link") return "enlace";
    if (role === "tab") return "pestaña";
    if (role === "checkbox" || role === "switch" || role === "radio") return "casilla";
    return "botón";
  }

  // Un botón sin texto (solo un ícono) se nombra por lo que tiene al lado: el título de su fila o,
  // si no hay, el nombre del ícono. Así se pueden abrir acordeones como los del SII.
  function contextLabel(el) {
    var p = el.parentElement;
    for (var k = 0; k < 3 && p && p !== document.body; k++, p = p.parentElement) {
      var t = clean(p.innerText);
      if (t && t.length <= 90) return t;
      if (t) break;
    }
    var m = /(?:^|\s)(?:bi|fa|fas|far|icon|glyphicon|mdi)-([a-z0-9-]+)/i.exec(typeof el.className === "string" ? el.className : "");
    return m ? m[1].replace(/-/g, " ") : "";
  }

  var DOC_URL = /\.(pdf|xml|csv|xlsx?|zip)(\?|#|$)|pdf|descarg|download/i;

  var CONTROLS =
    "a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], " +
    "[role=menuitem], [role=checkbox], [role=switch], [onclick], iframe[src], embed[src], object[data]";

  // Elementos que se pulsan sin ser botones ni enlaces (menús y acordeones hechos con <div>, <li> o
  // <a> sin dirección): se reconocen por el cursor de mano. Solo el más externo y con texto corto.
  function pointerExtras(limit) {
    var out = [];
    var all = [];
    try {
      all = document.querySelectorAll("a:not([href]), summary, li, div, span, td, h2, h3, h4, h5, p, [tabindex], [data-toggle], [data-bs-toggle]");
    } catch (e) {}
    for (var i = 0; i < all.length && i < 6000 && out.length < limit; i++) {
      var el = all[i];
      try {
        if (window.getComputedStyle(el).cursor !== "pointer") continue;
        var p = el.parentElement;
        if (p && p !== document.body && window.getComputedStyle(p).cursor === "pointer") continue;
        if (el.closest(CONTROLS) || el.querySelector(CONTROLS + ", label")) continue;
        if (!visible(el)) continue;
        var t = clean(el.innerText);
        // Una tarjeta que es solo una imagen (un medio de pago, un ícono) vale por su texto alternativo.
        if (!t) t = iconLabel(el);
        if (!t || t.length > 80) continue;
        out.push(el);
      } catch (e) {}
    }
    return out;
  }

  // Nombre de un elemento sin texto: su etiqueta accesible, su título o el de la imagen que contiene.
  function iconLabel(el) {
    var t = el.getAttribute("aria-label") || el.getAttribute("title") || "";
    if (!clean(t) && el.querySelector) {
      var img = el.querySelector("img[alt], svg[aria-label], [title]");
      if (img) t = img.getAttribute("alt") || img.getAttribute("aria-label") || img.getAttribute("title") || "";
    }
    return clean(t, 90);
  }

  // Una casilla u opción oculta (dibujada con una tarjeta o una imagen) se maneja por su etiqueta
  // visible: se pulsa la etiqueta y el estado se lee de la casilla.
  function proxyOf(el) {
    var l = null;
    try {
      if (el.id) l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    } catch (e) {}
    if (!l && el.closest) l = el.closest("label");
    if (!l && el.parentElement && el.parentElement !== document.body) l = el.parentElement;
    return l && visible(l) ? l : null;
  }

  function snapshot() {
    var out = [];
    var list = [];
    try {
      list = Array.prototype.slice.call(document.querySelectorAll(CONTROLS));
    } catch (e) {}
    var std = list.length;
    list = list.concat(pointerExtras(120));
    for (var i = 0; i < list.length && out.length < MAX_CONTROLS; i++) {
      var el = list[i];
      var tag = el.tagName.toLowerCase();
      if (tag === "input" && (el.type || "").toLowerCase() === "hidden") continue;
      var kind = kindOf(el);
      var target = el;
      if (i < std && !visible(el)) {
        if (kind !== "casilla" || tag !== "input") continue;
        target = proxyOf(el);
        if (!target) continue;
      }
      var c = { n: 0, k: kind, l: labelOf(el) };
      if (target !== el) c.l = clean(target.innerText, 90) || iconLabel(target) || c.l;
      if (kind === "documento") {
        var src = el.src || el.data || "";
        if (!DOC_URL.test(src) && !/pdf/i.test(el.type || "")) continue;
        c.l = c.l || "documento incrustado";
      } else if (kind === "campo") {
        c.v = clean(el.value, 120);
      } else if (kind === "clave") {
        c.v = el.value ? "(con contenido)" : "";
      } else if (kind === "lista") {
        var o = el.options[el.selectedIndex];
        c.v = o ? clean(o.text, 60) : "";
        c.o = [];
        for (var j = 0; j < el.options.length && j < 14; j++) c.o.push(clean(el.options[j].text, 40));
        if (el.options.length > 14) c.o.push("… " + (el.options.length - 14) + " más");
      } else if (kind === "casilla") {
        c.v = el.checked || el.getAttribute("aria-checked") === "true" ? "marcada" : "sin marcar";
      } else if (!c.l) {
        c.l = contextLabel(el);
        if (!c.l) continue;
      }
      if (kind === "botón" && el.hasAttribute("aria-expanded"))
        c.v = el.getAttribute("aria-expanded") === "true" ? "abierto" : "cerrado";
      if (el.disabled || el.getAttribute("aria-disabled") === "true") c.d = 1;
      c.n = refOf(target);
      out.push(c);
    }
    var said = alerts;
    alerts = [];
    var text = "";
    try {
      text = (document.body && document.body.innerText) || "";
    } catch (e) {}
    text = text.replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return {
      href: location.href,
      title: clean(document.title, 200),
      type: document.contentType || "",
      text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n[…texto recortado…]" : text,
      controls: out,
      doc: DOC,
      alerts: said,
    };
  }

  function setValue(el, v) {
    var proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, "value");
    try {
      el.focus();
    } catch (e) {}
    if (d && d.set) d.set.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function press(el) {
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (e) {}
    var o = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new MouseEvent("mousedown", o));
      el.dispatchEvent(new MouseEvent("mouseup", o));
    } catch (e) {}
    el.click();
  }

  // Acciones sobre un control de la última lectura de ESTE marco.
  function act(a) {
    var el = a.doc && a.doc !== DOC ? null : elAt(a.n);
    if (!el || !el.isConnected) return { error: "ese control ya no está: vuelve a leer la página" };
    var kind = kindOf(el);
    if (a.op === "clic") {
      if (el.disabled) return { error: "ese control está desactivado" };
      setTimeout(function () {
        press(el);
      }, 120);
      return { ok: "clic en «" + labelOf(el) + "»" };
    }
    if (a.op === "escribir") {
      if (kind === "clave")
        return { error: "las claves no se escriben: las rellena NÚCLEO con el acceso guardado" };
      if (kind !== "campo") return { error: "ese control no es un campo de texto" };
      setValue(el, String(a.texto == null ? "" : a.texto));
      if (a.enter) {
        var k = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
        setTimeout(function () {
          el.dispatchEvent(new KeyboardEvent("keydown", k));
          el.dispatchEvent(new KeyboardEvent("keypress", k));
          el.dispatchEvent(new KeyboardEvent("keyup", k));
          if (el.form && el.form.requestSubmit) {
            try {
              el.form.requestSubmit();
            } catch (e) {}
          }
        }, 120);
      }
      return { ok: "escrito en «" + labelOf(el) + "»" };
    }
    if (a.op === "elegir") {
      if (kind !== "lista") return { error: "ese control no es una lista" };
      var want = clean(a.opcion).toLowerCase();
      var hit = -1;
      for (var i = 0; i < el.options.length; i++) {
        var t = clean(el.options[i].text).toLowerCase();
        if (t === want) {
          hit = i;
          break;
        }
        if (hit < 0 && want && t.indexOf(want) >= 0) hit = i;
      }
      if (hit < 0) return { error: "no hay una opción «" + a.opcion + "» en esa lista" };
      el.selectedIndex = hit;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: "elegido «" + clean(el.options[hit].text, 60) + "»" };
    }
    if (a.op === "direccion") {
      var u = el.href || el.src || el.data || "";
      return u ? { url: u } : { error: "ese control no lleva a un archivo" };
    }
    return { error: "acción desconocida" };
  }

  function toBase64(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  // Texto de un PDF sencillo (como los documentos del SII): descomprime cada flujo de contenido y
  // junta lo que se dibuja con Tj/TJ, una línea por salto. Si el PDF usa otra codificación, no sale
  // texto y se informa: el archivo se guarda igual.
  async function pdfText(bytes) {
    if (typeof DecompressionStream === "undefined") return null;
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    var lines = [];
    var pos = 0;
    var dec = function (t) {
      return t
        .replace(/\\([0-7]{1,3})/g, function (_, o) {
          return String.fromCharCode(parseInt(o, 8));
        })
        .replace(/\\([()\\])/g, "$1");
    };
    var re = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\]\\]|\\.)*\]\s*TJ|T\*|-?[\d.]+\s+-?[\d.]+\s+T[dD]|(?:-?[\d.]+\s+){6}Tm|ET/g;
    for (var guard = 0; guard < 400; guard++) {
      var a = s.indexOf("stream", pos);
      if (a < 0) break;
      var st = a + 6;
      if (s[st] === "\r") st++;
      if (s[st] === "\n") st++;
      var e = s.indexOf("endstream", st);
      if (e < 0) break;
      pos = e + 9;
      var dict = s.slice(Math.max(0, a - 300), a);
      if (/\/Subtype\s*\/Image/.test(dict) || !/FlateDecode/.test(dict) || /ASCII85Decode|ASCIIHexDecode/.test(dict)) continue;
      var txt = "";
      try {
        var ds = new DecompressionStream("deflate");
        var w = ds.writable.getWriter();
        w.write(bytes.subarray(st, e));
        w.close();
        var out = new Uint8Array(await new Response(ds.readable).arrayBuffer());
        for (var k = 0; k < out.length; k += 0x8000) txt += String.fromCharCode.apply(null, out.subarray(k, k + 0x8000));
      } catch (err) {
        continue;
      }
      if (!/BT[\s\S]*ET/.test(txt)) continue;
      var cur = "";
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(txt))) {
        var t = m[0];
        if (/Tj$/.test(t)) cur += dec(t.slice(1, t.lastIndexOf(")")));
        else if (/TJ$/.test(t)) {
          var inner = t.slice(1, t.lastIndexOf("]"));
          var r2 = /\((?:\\.|[^\\)])*\)/g;
          var q;
          while ((q = r2.exec(inner))) cur += dec(q[0].slice(1, -1));
        } else {
          if (cur.trim()) lines.push(cur.trim());
          cur = "";
        }
      }
      if (cur.trim()) lines.push(cur.trim());
    }
    var text = lines.join("\n");
    return text.length > 20000 ? text.slice(0, 20000) + "\n[…recortado…]" : text;
  }

  // Trae un archivo con la sesión de este marco y lo entrega en base64.
  function grab(a) {
    var url = a.url || "";
    if (a.n != null) {
      var r = act({ op: "direccion", n: a.n, doc: a.doc });
      if (r.error) return Promise.resolve(r);
      url = r.url;
    }
    if (!url) {
      if (/pdf/i.test(document.contentType || "")) url = location.href;
      else {
        var docs = document.querySelectorAll("iframe[src], embed[src], object[data]");
        var found = [];
        for (var i = 0; i < docs.length; i++) {
          var s = docs[i].src || docs[i].data || "";
          if (DOC_URL.test(s) || /pdf/i.test(docs[i].type || "")) found.push(s);
        }
        if (found.length === 1) url = found[0];
        else
          return Promise.resolve({
            error: found.length
              ? "hay más de un documento en la página: indica cuál (elemento)"
              : "no veo un documento en esta página: indica el enlace (elemento) o la dirección",
          });
      }
    }
    var abs;
    try {
      abs = new URL(url, location.href);
    } catch (e) {
      return Promise.resolve({ error: "esa dirección no es válida" });
    }
    if (abs.protocol !== "https:") return Promise.resolve({ error: "solo se guardan archivos de direcciones https" });
    return fetch(abs.href, { credentials: "include" })
      .then(function (res) {
        if (!res.ok) throw new Error("el sitio respondió " + res.status);
        var disp = res.headers.get("content-disposition") || "";
        var m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
        var type = res.headers.get("content-type") || "";
        return res.arrayBuffer().then(function (buf) {
          if (buf.byteLength > MAX_FILE) throw new Error("el archivo pesa más de 25 MB");
          var head = new Uint8Array(buf.slice(0, 5));
          var magic = String.fromCharCode.apply(null, head);
          var file = {
            suggested: m ? decodeURIComponent(m[1]) : abs.pathname.split("/").pop() || "",
            type: type,
            pdf: magic === "%PDF-",
            html: /text\/html/i.test(type),
            size: buf.byteLength,
            b64: toBase64(buf),
          };
          if (!file.pdf) return { file: file };
          return pdfText(new Uint8Array(buf))
            .catch(function () {
              return null;
            })
            .then(function (text) {
              if (text) file.text = text;
              return { file: file };
            });
        });
      })
      .catch(function (e) {
        return { error: "no se pudo traer el archivo: " + (e && e.message ? e.message : e) };
      });
  }

  /* ───────────── Ingreso con el gestor de contraseñas ───────────── */

  var USER_HINT = /user|usuario|\brut\b|login|e-?mail|correo|identif/i;
  var NOT_USER = /busc|search|filtr/i;
  var GO_HINT = /ingres|entrar|iniciar|continuar|siguiente|acceder|aceptar|login|log in|sign in|enviar/i;

  function textInputs(root) {
    var all = root.querySelectorAll("input");
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].type || "text").toLowerCase();
      if (["text", "email", "tel", "number", "search", ""].indexOf(t) >= 0 && visible(all[i]) && !all[i].disabled)
        out.push(all[i]);
    }
    return out;
  }

  function loginFields() {
    var pws = document.querySelectorAll("input[type=password]");
    var pw = null;
    for (var i = 0; i < pws.length; i++) {
      if (visible(pws[i]) && !pws[i].disabled) {
        pw = pws[i];
        break;
      }
    }
    var scope = (pw && pw.form) || document;
    var texts = textInputs(scope);
    var user = null;
    if (pw) {
      for (var j = 0; j < texts.length; j++) {
        if (texts[j].compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) user = texts[j];
      }
    } else {
      for (var k = 0; k < texts.length; k++) {
        var x = texts[k];
        var hint = [x.name, x.id, x.placeholder, x.getAttribute("autocomplete"), x.getAttribute("aria-label")].join(" ");
        // Sin campo de clave a la vista (ingreso en dos pasos) solo vale un campo que diga ser el
        // del usuario: un buscador u otro campo cualquiera no se toca.
        if (USER_HINT.test(hint) && !NOT_USER.test(hint) && (x.type || "").toLowerCase() !== "search") {
          user = x;
          break;
        }
      }
    }
    return { pw: pw, user: user };
  }

  function submitOf(f) {
    var form = (f.pw && f.pw.form) || (f.user && f.user.form) || null;
    var root = form || document;
    var c = root.querySelectorAll("button, input[type=submit], input[type=button], [role=button]");
    var best = null;
    for (var i = 0; i < c.length; i++) {
      if (!visible(c[i]) || c[i].disabled) continue;
      var t = (c[i].type || "").toLowerCase();
      if (form && t === "submit") return c[i];
      if (!best && GO_HINT.test(labelOf(c[i]))) best = c[i];
    }
    return best || form;
  }

  function probeLogin() {
    var f = loginFields();
    return { host: location.host, origin: location.origin, clave: !!f.pw, usuario: !!f.user };
  }

  function fillLogin(a) {
    var site = String(a.site || "");
    var host = location.hostname.toLowerCase();
    if (!site || !(host === site || host.slice(-(site.length + 1)) === "." + site))
      return { error: "esta página no es del sitio del acceso" };
    if (location.protocol !== "https:") return { error: "la página no es https" };
    var f = loginFields();
    if (!f.pw && !f.user) return { usuario: false, clave: false, enviado: false };
    if (f.user && a.usuario) setValue(f.user, a.usuario);
    if (f.pw) setValue(f.pw, a.clave);
    var sent = false;
    if (a.enviar) {
      var go = submitOf(f);
      if (go) {
        sent = true;
        setTimeout(function () {
          if (go.tagName === "FORM") {
            if (go.requestSubmit) go.requestSubmit();
            else go.submit();
          } else press(go);
        }, 150);
      }
    }
    return { usuario: !!f.user, clave: !!f.pw, enviado: sent };
  }

  /* ───────────── Firma de un documento (SII) ───────────── */

  // La página de firma tiene un solo campo de clave y un botón «Firmar». NÚCLEO escribe ahí la
  // clave de firma solo después de que la persona aprobó ese documento en la aplicación.
  var SIGN_HINT = /^\s*firmar?\b/i;

  function signFields() {
    var pws = document.querySelectorAll("input[type=password]");
    var live = [];
    for (var i = 0; i < pws.length; i++) if (visible(pws[i]) && !pws[i].disabled) live.push(pws[i]);
    var pw = live.length === 1 ? live[0] : null;
    var go = null;
    var roots = pw && pw.form ? [pw.form, document] : [document];
    for (var r = 0; r < roots.length && !go; r++) {
      var c = roots[r].querySelectorAll("button, input[type=submit], input[type=button], [role=button]");
      for (var j = 0; j < c.length; j++) {
        if (!visible(c[j]) || c[j].disabled) continue;
        if (SIGN_HINT.test(labelOf(c[j]))) {
          go = c[j];
          break;
        }
      }
    }
    return { pw: pw, go: go, claves: live.length };
  }

  function probeSign() {
    var f = signFields();
    var body = "";
    try {
      body = document.body ? document.body.innerText : "";
    } catch (e) {}
    return {
      host: location.host,
      clave: !!f.pw,
      claves: f.claves,
      boton: f.go ? clean(labelOf(f.go), 60) : "",
      titulo: clean(document.title, 120),
      texto: clean(body, 500),
    };
  }

  function fillSign(a) {
    var site = String(a.site || "");
    var host = location.hostname.toLowerCase();
    if (!site || !(host === site || host.slice(-(site.length + 1)) === "." + site))
      return { error: "esta página no es del SII" };
    if (location.protocol !== "https:") return { error: "la página no es https" };
    var f = signFields();
    if (!f.pw || !f.go) return { error: "la página de firma cambió: no hay un campo de clave y un botón «Firmar»" };
    setValue(f.pw, a.clave);
    var go = f.go;
    setTimeout(function () {
      press(go);
    }, 150);
    return { clave: true, enviado: true, boton: clean(labelOf(go), 60) };
  }

  /* ───────────── Mensajes entre marcos ───────────── */

  function handle(op, a) {
    if (op === "leer") return Promise.resolve(snapshot());
    if (op === "actuar") return Promise.resolve(act(a));
    if (op === "guardar") return grab(a);
    if (op === "sondear") return Promise.resolve(probeLogin());
    if (op === "rellenar") return Promise.resolve(fillLogin(a));
    if (op === "sondear_firma") return Promise.resolve(probeSign());
    if (op === "firmar") return Promise.resolve(fillSign(a));
    return Promise.resolve({ error: "orden desconocida" });
  }

  window.addEventListener(
    "message",
    function (ev) {
      var m = ev.data;
      if (!m || m[K] !== 1 || TOP) return;
      // Las órdenes solo valen si vienen del marco principal.
      var fromTop = false;
      try {
        fromTop = ev.source === window.top;
      } catch (e) {}
      if (!fromTop) return;
      handle(m.op, m.a || {}).then(function (data) {
        var msg = { id: m.id, path: m.path, data: data };
        msg[K] = 2;
        window.top.postMessage(msg, "*");
      });
    },
    false
  );

  if (!TOP) return;

  /* ───────────── Solo el marco principal ───────────── */

  var waiting = {}; // id → { left, got, done }
  var refs = []; // número global − 1 → { path, n, doc }
  var refKeys = {}; // "marco|documento|número local" → número global (se conserva entre lecturas)

  window.addEventListener(
    "message",
    function (ev) {
      var m = ev.data;
      if (!m || m[K] !== 2) return;
      var w = waiting[m.id];
      if (!w || !(m.path in w.left)) return;
      // La respuesta tiene que venir del mismo marco al que se le preguntó.
      if (w.left[m.path] !== ev.source) return;
      delete w.left[m.path];
      w.got.push({ path: m.path, origin: ev.origin, data: m.data });
      if (!Object.keys(w.left).length) w.done();
    },
    false
  );

  function frameList() {
    var out = [];
    (function walk(win, path, depth) {
      var n = 0;
      try {
        n = win.length;
      } catch (e) {}
      for (var i = 0; i < n && out.length < 60; i++) {
        var child = null;
        try {
          child = win[i];
        } catch (e) {}
        if (!child) continue;
        var p = path ? path + "." + i : String(i);
        out.push({ path: p, win: child });
        if (depth < 4) walk(child, p, depth + 1);
      }
    })(window, "", 0);
    return out;
  }

  function winAt(path) {
    var w = window;
    var parts = String(path).split(".");
    for (var i = 0; i < parts.length; i++) {
      try {
        w = w[Number(parts[i])];
      } catch (e) {
        return null;
      }
      if (!w) return null;
    }
    return w;
  }

  // Pregunta a varios marcos y junta lo que alcancen a contestar.
  function ask(id, targets, op, a, ms, origin) {
    return new Promise(function (resolve) {
      var w = { left: {}, got: [] };
      var timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        delete waiting[id];
        resolve(w.got);
      }
      w.done = finish;
      waiting[id] = w;
      var sent = 0;
      for (var i = 0; i < targets.length; i++) {
        var msg = { id: id, path: targets[i].path, op: op, a: a };
        msg[K] = 1;
        try {
          targets[i].win.postMessage(msg, origin || "*");
          w.left[targets[i].path] = targets[i].win;
          sent++;
        } catch (e) {}
      }
      if (!sent) finish();
    });
  }

  function readAll(id) {
    var own = snapshot();
    return ask(id, frameList(), "leer", {}, 1500).then(function (got) {
      got.sort(function (x, y) {
        return x.path < y.path ? -1 : 1;
      });
      var frames = [{ path: "", data: own }].concat(got);
      var out = [];
      var said = [];
      for (var i = 0; i < frames.length; i++) {
        var d = frames[i].data;
        if (!d || !d.controls) continue;
        for (var j = 0; j < d.controls.length; j++) {
          var key = frames[i].path + "|" + d.doc + "|" + d.controls[j].n;
          if (!refKeys[key]) {
            refs.push({ path: frames[i].path, n: d.controls[j].n, doc: d.doc });
            refKeys[key] = refs.length;
          }
          d.controls[j].n = refKeys[key];
        }
        if (d.alerts && d.alerts.length) said = said.concat(d.alerts);
        delete d.alerts;
        delete d.doc;
        if (frames[i].path === "" || d.text || d.controls.length) {
          d.path = frames[i].path;
          out.push(d);
        }
      }
      return { url: location.href, title: clean(document.title, 200), frames: out, alerts: said };
    });
  }

  function onRef(id, num, op, a, ms) {
    var r = refs[Number(num) - 1];
    if (!r) return Promise.resolve({ error: "no conozco «w" + num + "»: vuelve a leer la página" });
    a = a || {};
    a.n = r.n;
    a.doc = r.doc;
    if (r.path === "") return handle(op, a);
    var win = winAt(r.path);
    if (!win) return Promise.resolve({ error: "ese marco ya no está: vuelve a leer la página" });
    return ask(id, [{ path: r.path, win: win }], op, a, ms || 4000).then(function (got) {
      return got.length ? got[0].data : { error: "el marco no respondió: vuelve a leer la página" };
    });
  }

  function login(id, a) {
    var mine = probeLogin();
    var site = String(a.site || "");
    function sameSite(h) {
      h = String(h || "").toLowerCase().split(":")[0];
      return !!site && (h === site || h.slice(-(site.length + 1)) === "." + site);
    }
    if ((mine.clave || mine.usuario) && sameSite(location.hostname)) return Promise.resolve(fillLogin(a));
    return ask(id + "s", frameList(), "sondear", {}, 1200).then(function (got) {
      var pick = null;
      for (var i = 0; i < got.length; i++) {
        var d = got[i].data || {};
        // El origen lo informa el navegador (ev.origin), no el marco.
        var o = got[i].origin || "";
        if (!/^https:\/\//.test(o) || !sameSite(o.slice(8))) continue;
        if (d.clave) {
          pick = got[i];
          break;
        }
        if (d.usuario && !pick) pick = got[i];
      }
      if (!pick) {
        if (mine.clave || mine.usuario) return { error: "esta página no es del sitio del acceso" };
        return { usuario: false, clave: false, enviado: false };
      }
      var win = winAt(pick.path);
      if (!win) return { error: "el formulario de ingreso ya no está" };
      // Con el origen exacto como destino: si el marco cambió de sitio, el mensaje no se entrega.
      return ask(id + "f", [{ path: pick.path, win: win }], "rellenar", a, 4000, pick.origin).then(function (r) {
        return r.length ? r[0].data : { error: "el formulario de ingreso no respondió" };
      });
    });
  }

  // Busca la página de firma (en el documento principal o en un marco del mismo sitio).
  function signTarget(id, site) {
    function sameSite(h) {
      h = String(h || "").toLowerCase().split(":")[0];
      return !!site && (h === site || h.slice(-(site.length + 1)) === "." + site);
    }
    var own = { path: "", origin: location.origin, data: probeSign() };
    return ask(id + "s", frameList(), "sondear_firma", {}, 1200).then(function (got) {
      var all = [own].concat(got);
      var claves = 0;
      for (var i = 0; i < all.length; i++) {
        var d = all[i].data || {};
        // El origen lo informa el navegador (ev.origin), no el marco.
        var o = all[i].origin || "";
        if (!/^https:\/\//.test(o) || !sameSite(o.slice(8))) continue;
        claves += d.claves || 0;
        if (d.clave && d.boton) return { pick: all[i], claves: claves };
      }
      return { pick: null, claves: claves };
    });
  }

  function signProbe(id, a) {
    return signTarget(id, String(a.site || "")).then(function (t) {
      if (!t.pick) return { firma: false, claves: t.claves, titulo: clean(document.title, 120) };
      var d = t.pick.data;
      return { firma: true, boton: d.boton, titulo: d.titulo || clean(document.title, 120), texto: d.texto };
    });
  }

  function sign(id, a) {
    var site = String(a.site || "");
    return signTarget(id, site).then(function (t) {
      if (!t.pick) return { error: "la página de firma ya no está a la vista" };
      if (t.pick.path === "") return fillSign(a);
      var win = winAt(t.pick.path);
      if (!win) return { error: "la página de firma ya no está a la vista" };
      // Con el origen exacto como destino: si el marco cambió de sitio, el mensaje no se entrega.
      return ask(id + "f", [{ path: t.pick.path, win: win }], "firmar", a, 4000, t.pick.origin).then(function (r) {
        return r.length ? r[0].data : { error: "la página de firma no respondió" };
      });
    });
  }

  /* ───────────── Respuesta a NÚCLEO ───────────── */

  // NÚCLEO lanza la orden y después pregunta por el resultado (evaluación con respuesta, que no
  // depende de la política del sitio). El resultado se guarda como JSON solo ASCII para poder
  // entregarlo por partes sin cortar caracteres.
  var results = {};

  function finish(id, obj) {
    var body;
    try {
      body = JSON.stringify(obj);
    } catch (e) {
      body = JSON.stringify({ error: "la página devolvió algo que no se puede leer" });
    }
    results[id] = body.replace(/[\u0080-\uffff]/g, function (c) {
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  var api = {
    size: function (id) {
      return id in results ? results[id].length : -1;
    },
    part: function (id, from, to) {
      return id in results ? results[id].slice(from, to) : "";
    },
    done: function (id) {
      delete results[id];
      return true;
    },
    run: function (cmd) {
      var id = String(cmd.id);
      var p;
      try {
        if (cmd.op === "leer") p = readAll(id);
        else if (cmd.op === "clic" || cmd.op === "escribir" || cmd.op === "elegir")
          p = onRef(id, cmd.ref, "actuar", { op: cmd.op, texto: cmd.texto, enter: cmd.enter, opcion: cmd.opcion });
        else if (cmd.op === "guardar")
          p = cmd.ref ? onRef(id, cmd.ref, "guardar", {}, 60000) : grab({ url: cmd.url });
        else if (cmd.op === "rellenar") p = login(id, cmd);
        else if (cmd.op === "sondear_firma") p = signProbe(id, cmd);
        else if (cmd.op === "firmar") p = sign(id, cmd);
        else if (cmd.op === "volver") {
          setTimeout(function () {
            history.back();
          }, 150);
          p = Promise.resolve({ ok: "volviendo a la página anterior" });
        } else p = Promise.resolve({ error: "orden desconocida" });
      } catch (e) {
        p = Promise.resolve({ error: String(e && e.message ? e.message : e) });
      }
      p.then(
        function (data) {
          finish(id, data);
        },
        function (e) {
          finish(id, { error: String(e && e.message ? e.message : e) });
        }
      );
      return "ok";
    },
  };
  try {
    Object.defineProperty(window, "__nucleoWeb", { value: api });
  } catch (e) {}
})();
