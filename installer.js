const installPage = document.querySelector("#install-page");
const pluginApp = document.querySelector("#plugin-app");
const embedded = window.parent !== window;
const isLocalHost =
  location.hostname === "127.0.0.1" || location.hostname === "localhost";

if (embedded) {
  document.body.classList.add("is-plugin");
  if (isLocalHost) {
    document.body.classList.add("is-local");
    const version = pluginApp?.querySelector(".version");
    const subtitle = pluginApp?.querySelector(".brand-copy p");
    if (version) version.textContent = "v0.3.5 LOCAL";
    if (subtitle) subtitle.textContent = "Local test build · 127.0.0.1:4173";
  }
  installPage?.remove();
  pluginApp?.removeAttribute("hidden");
  await import(`./src/app.js?v=0.3.5&local=${isLocalHost ? "1" : "0"}`);
} else {
  document.body.classList.add("is-installer");
  pluginApp?.remove();
  installPage?.removeAttribute("hidden");
}
