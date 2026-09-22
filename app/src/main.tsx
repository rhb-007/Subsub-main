import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// A white screen is the one failure this app has shipped more than once, and
// it is the only one that tells whoever hit it nothing at all -- not what
// broke, not whether it was them, not what to try. Twice now the cause has
// been found by hand, from a screenshot of nothing.
//
// React unmounts the whole tree when a render throws, which is what turns one
// bad value into an empty page. This catches that and puts the error on the
// screen instead. It is not there to keep the app running -- it cannot -- but
// to make the next one a five-minute fix rather than an afternoon.
//
// "Sign out and start over" is here because a crash caused by something kept
// in this browser (a stale session, a half-written draft) survives a reload,
// and on a phone or a tablet there is no other way out of it.
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, where: "" };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    // The first few frames of the component stack name the screen it
    // happened on, which is most of the diagnosis.
    const where = String(info?.componentStack || "").trim().split("\n").slice(0, 4).join("\n");
    this.setState({ where });
    console.error("[crash]", err, info);
  }
  render() {
    if (!this.state.err) return this.props.children;
    const msg = String(this.state.err?.message || this.state.err || "Unknown error");
    return (
      <div style={{ font: "15px/1.55 Inter,system-ui,sans-serif", color: "#0f172a",
                    maxWidth: 640, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ font: "700 20px/1.3 Inter,system-ui,sans-serif", margin: "0 0 10px" }}>
          This page hit a problem and stopped.
        </h1>
        <p style={{ margin: "0 0 18px", color: "#475569" }}>
          Nothing you did caused it and nothing was lost. Send whoever looks after
          SubSub a picture of this screen — the part in the box is what they need.
        </p>
        <pre style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 10,
                      padding: "12px 14px", margin: "0 0 20px", whiteSpace: "pre-wrap",
                      wordBreak: "break-word", font: "12.5px/1.5 ui-monospace,Menlo,monospace" }}>
          {msg}{this.state.where ? "\n" + this.state.where : ""}
        </pre>
        <button onClick={() => window.location.reload()}
          style={{ background: "#103528", color: "#fff", border: 0, borderRadius: 9,
                   padding: "11px 16px", font: "700 14px Inter,sans-serif", cursor: "pointer" }}>
          Reload the page
        </button>
        <button onClick={() => {
          // Whatever this browser is holding is the likeliest thing a reload
          // will not fix, so this is the second button and not the first.
          try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked storage */ }
          window.location.href = "/";
        }}
          style={{ background: "transparent", color: "#475569", border: "1px solid #cbd5e1",
                   borderRadius: 9, padding: "11px 16px", marginLeft: 10,
                   font: "600 14px Inter,sans-serif", cursor: "pointer" }}>
          Sign out and start over
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <Boundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </Boundary>
);
