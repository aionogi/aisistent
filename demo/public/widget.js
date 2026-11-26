/*
 * aisistent website chat. A firm adds this before </body>:
 *   <script src="https://<aisistent address>/widget.js" data-aisistent="<widget id>" async></script>
 * It shows a round button that opens the firm's chat in a frame served by
 * aisistent. The frame loads only when the visitor first opens it. The script
 * reads nothing from the page, sets no cookies and only remembers, for this
 * tab, whether the chat was open.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.aisistentChatLoaded) return;
  var id = script.getAttribute("data-aisistent") || "";
  if (!/^[0-9a-f]{20}$/.test(id)) return;
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (error) {
    return;
  }
  window.aisistentChatLoaded = true;

  var OPEN_KEY = "aisistent-chat-open:" + id;
  var SVG = "http://www.w3.org/2000/svg";
  var frame = null;
  var open = false;

  // Set with !important so the website's own styles cannot change the widget.
  function css(element, styles) {
    for (var name in styles) element.style.setProperty(name, styles[name], "important");
  }

  function icon(paths) {
    var svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "26");
    svg.setAttribute("height", "26");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (var index = 0; index < paths.length; index++) {
      var path = document.createElementNS(SVG, "path");
      path.setAttribute("d", paths[index]);
      svg.appendChild(path);
    }
    return svg;
  }
  var chatIcon = icon(["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]);
  var closeIcon = icon(["M18 6 6 18", "m6 6 12 12"]);

  var root = document.createElement("div");
  css(root, { position: "fixed", right: "20px", bottom: "20px", "z-index": "2147483000", margin: "0", padding: "0" });

  var button = document.createElement("button");
  button.type = "button";
  css(button, {
    display: "grid", "place-items": "center", width: "56px", height: "56px", margin: "0", padding: "0", border: "0",
    "border-radius": "50%", background: "#2159e8", color: "#fff", cursor: "pointer",
    "box-shadow": "0 6px 20px rgba(20, 32, 56, .25)",
  });

  function remember(value) {
    try {
      if (value) window.sessionStorage.setItem(OPEN_KEY, "1");
      else window.sessionStorage.removeItem(OPEN_KEY);
    } catch (error) {
      // Storage may be off; the chat then simply starts closed on the next page.
    }
  }

  function place() {
    if (!frame) return;
    var narrow = window.innerWidth < 480;
    css(frame, {
      width: narrow ? "calc(100vw - 24px)" : "380px",
      height: narrow ? "calc(100vh - 100px)" : "min(600px, calc(100vh - 110px))",
      right: narrow ? "-8px" : "0",
    });
  }

  function render() {
    button.replaceChildren(open ? closeIcon : chatIcon);
    button.setAttribute("aria-label", open ? "Zatvori chat" : "Otvori chat sa asistentom");
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (frame) css(frame, { display: open ? "block" : "none" });
  }

  function toggle(value) {
    open = value;
    if (open && !frame) {
      frame = document.createElement("iframe");
      frame.src = origin + "/chat/" + id + "/";
      frame.title = "Chat sa asistentom";
      frame.setAttribute("loading", "eager");
      css(frame, {
        position: "absolute", bottom: "72px", border: "0", "border-radius": "14px", background: "#fff",
        "box-shadow": "0 12px 40px rgba(20, 32, 56, .22)", "max-width": "none", margin: "0", padding: "0",
      });
      root.appendChild(frame);
      place();
    }
    render();
    remember(open);
  }

  button.addEventListener("click", function () {
    toggle(!open);
  });
  document.addEventListener("keydown", function (event) {
    if (open && event.key === "Escape") {
      toggle(false);
      button.focus();
    }
  });
  window.addEventListener("resize", place);

  root.appendChild(button);
  render();
  function mount() {
    document.body.appendChild(root);
    var reopen = false;
    try {
      reopen = window.sessionStorage.getItem(OPEN_KEY) === "1";
    } catch (error) {
      reopen = false;
    }
    if (reopen) toggle(true);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
