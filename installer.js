const installPage = document.querySelector("#install-page");
const pluginApp = document.querySelector("#plugin-app");
const embedded = window.parent !== window;

if (embedded) {
  document.body.classList.add("is-plugin");
  installPage?.remove();
  pluginApp?.removeAttribute("hidden");
  await import("./src/app.js?v=0.2.0");
} else {
  document.body.classList.add("is-installer");
  pluginApp?.remove();
  installPage?.removeAttribute("hidden");
}
