import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router.ts";
import { setUnauthorizedHandler } from "./api/http.ts";
// Self-hosted fonts: the app must work offline (no Google Fonts).
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/silkscreen/400.css";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

setUnauthorizedHandler(() => {
  if (router.currentRoute.value.name !== "login") {
    void router.push({ name: "login", query: { next: router.currentRoute.value.fullPath } });
  }
});

app.mount("#app");
