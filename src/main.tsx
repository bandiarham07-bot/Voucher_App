import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./app/App.tsx";
import "./styles/index.css";

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info("App ready for offline use.");
  },
});

createRoot(document.getElementById("root")!).render(<App />);
