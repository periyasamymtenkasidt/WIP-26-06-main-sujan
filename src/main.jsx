import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { seedDefaultTerms } from "./data/termsStorage";
import { seedLeadScopeData } from "./data/seedLeadScope";

// Seed default T&C records into localStorage on first launch.
// Runs synchronously before React mounts so every component sees the data.
seedDefaultTerms();

// Seed scope-of-work data for existing leads that have a preset + grade but
// no saved quoteScopeItems.  Maps each lead's preset scope to its quality
// grade so proposals, BOQ, survey and schedule all resolve correctly.
seedLeadScopeData();

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
