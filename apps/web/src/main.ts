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
  const cur = router.currentRoute.value;
  if (cur.name !== "login") {
    // before the first navigation finishes the route is the empty start route: use the address bar
    const next = cur.name ? cur.fullPath : `${location.pathname}${location.search}${location.hash}`;
    void router.push({ name: "login", query: { next } });
  }
});

app.mount("#app");
