import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { routes } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
