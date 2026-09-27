import ReactDOM from "react-dom/client";
import { Hud } from "./HudApp";

export function mountHud() {
  // Pencere saydam: yalnızca kart görünsün.
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Hud />);
}
