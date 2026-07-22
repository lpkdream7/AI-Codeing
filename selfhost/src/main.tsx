import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/page";
import "../../app/globals.css";
import { AuthPage } from "./auth-page";

const pathname = window.location.pathname;
const authMode = pathname === "/register" ? "register" : "login";
const content = pathname === "/login" || pathname === "/register"
  ? <AuthPage mode={authMode} />
  : <Home />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{content}</StrictMode>,
);
