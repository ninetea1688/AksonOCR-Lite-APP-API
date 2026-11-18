import React from "react";
import ReactDOM from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import App from "./App";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconContext.Provider value={{ "aria-hidden": true }}>
      <App />
    </IconContext.Provider>
  </React.StrictMode>,
);
