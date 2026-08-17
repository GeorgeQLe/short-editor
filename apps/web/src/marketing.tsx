import { SignInButton } from "@clerk/react";
import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="SiftCut home">
      <img src="/app-web-icon-512.png" alt="" />
      <span>SiftCut</span>
    </a>
  );
}

export function CommercialHeader({ authEnabled }: { authEnabled: boolean }) {
  return (
    <header className="site-header">
      <Brand />
      <CommercialHeaderActions authEnabled={authEnabled} />
    </header>
  );
}

export function CommercialHeaderActions({ authEnabled = true }: { authEnabled?: boolean }) {
  return <div className="marketing-nav">
    <nav aria-label="Primary navigation">
      <a href="#workflow">Workflow</a><a href="#products">Products</a><a href="#beta-status">Beta status</a>
    </nav>
    {authEnabled ? <SignInButton mode="modal"><button className="header-cta" type="button">Invited member sign in</button></SignInButton>
      : <a className="header-cta" href="/sign-in">Invited member sign in</a>}
  </div>;
}

export function CommercialMarketingPage() {
  return (
    <main className="marketing-main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Private beta · Creator teams</p>
          <h1 id="hero-title">Find the short hiding inside the long story.</h1>
          <p className="hero-deck">
            SiftCut is an AI-assisted, human-approved editing platform for
            podcast, YouTube, and small-studio teams—built to keep the context,
            decisions, and final cut in your hands.
          </p>
          <div className="hero-actions">
            <a className="primary hero-primary" href="#beta-access">Request beta access</a>
            <a className="secondary-link" href="#products">Meet the SiftCut family <span aria-hidden="true">↘</span></a>
          </div>
          <div className="trust-row" aria-label="Product principles">
            <span>Private media</span><span>Human-approved</span><span>Revision-aware</span>
          </div>
        </div>
        <ProductPreview />
      </section>

      <section className="signal-strip" aria-label="SiftCut workflow summary">
        <span>Long-form context</span><i aria-hidden="true" />
        <span>Strongest moments surfaced</span><i aria-hidden="true" />
        <span>Short-form clarity</span>
      </section>

      <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
        <div className="section-heading">
          <p className="eyebrow">A deliberate workflow</p>
          <h2 id="workflow-title">AI assists. Your team makes the call.</h2>
          <p>Keep the whole episode close while analysis, revision history, and review help the team move from source to approved short.</p>
        </div>
        <div className="workflow-grid">
          <WorkflowCard number="01" title="Bring the whole story" copy="Start with the source and its full context—not a pile of disconnected snippets." accent="violet" />
          <WorkflowCard number="02" title="Surface the signal" copy="Use transcript-led analysis to propose moments with a hook, a point, and enough context to stand alone." accent="mint" />
          <WorkflowCard number="03" title="Review, shape, approve" copy="People tune the edit and approve the revision before a deterministic render becomes the deliverable." accent="amber" />
        </div>
      </section>

      <ProductFamily />
      <ManagedService />
      <BetaStatus />
      <BetaAccessForm />

      <footer>
        <Brand />
        <p>Long-form context. Short-form clarity.</p>
        <span>Private beta</span>
      </footer>
    </main>
  );
}

function ProductPreview() {
  return (
    <div className="hero-product">
      <div className="preview-label"><span>Product preview</span><small>Illustrative · private-beta direction</small></div>
      <div className="product-window desktop-preview" aria-label="Illustrative SiftCut Cloud product preview">
        <div className="window-bar"><i /><i /><i /><span>Episode workspace · preview</span></div>
        <div className="product-body">
          <aside aria-hidden="true"><b>S</b><span className="selected">▦</span><span>✦</span><span>◫</span><span>□</span></aside>
          <div className="product-content">
            <div className="preview-heading"><div><small>EPISODE CONTEXT</small><h3>Find the moments worth shaping.</h3></div><button type="button" tabIndex={-1}>Review candidates</button></div>
            <div className="episode-row"><div className="episode-art"><span>41:18</span></div><div><small>ILLUSTRATIVE PROJECT</small><strong>Building a calmer creative system</strong><p>Transcript review · candidate proposals</p></div><b>68%</b></div>
            <div className="candidate-label"><span>Proposed moments</span><small>Human approval required</small></div>
            <div className="candidate-row"><i /><div><strong>The myth of waiting for inspiration</strong><p>00:08:42–00:09:37 · Hook and payoff proposed</p></div><span>Review →</span></div>
            <div className="candidate-row muted"><i /><div><strong>Build a system your tired self can use</strong><p>00:17:11–00:18:03 · Practical takeaway proposed</p></div><span>Review →</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowCard({ number, title, copy, accent }: { number: string; title: string; copy: string; accent: string }) {
  return <article className={`workflow-card ${accent}`}><span>{number}</span><div className="workflow-visual" aria-hidden="true"><i /><i /><i /></div><h3>{title}</h3><p>{copy}</p></article>;
}

function ProductFamily() {
  const products = [
    { name: "SiftCut Desktop", status: "Available", title: "Your local edit room.", copy: "The free, MIT-licensed, offline-first desktop editor. Work locally without a Cloud subscription.", note: "Free · open source" },
    { name: "SiftCut Cloud", status: "Private beta", title: "The managed team workspace.", copy: "Private media, collaboration, managed processing, deterministic rendering, storage, and support with bounded included usage.", note: "Paid managed product" },
    { name: "SiftCut Mobile", status: "Roadmap", title: "The companion in your pocket.", copy: "Capture, check status, review, and approve through the same Cloud account. It is not a full mobile edit bay.", note: "Paid Cloud companion" }
  ];
  return (
    <section className="products-section" id="products" aria-labelledby="products-title">
      <div className="section-heading"><p className="eyebrow">One product family</p><h2 id="products-title">A clear role for every screen.</h2><p>Desktop stands on its own. Cloud and Mobile share one team account, subscription, and included managed-usage allowance.</p></div>
      <div className="product-family-grid">{products.map((product) => <article key={product.name}><div><span>{product.name}</span><b>{product.status}</b></div><h3>{product.title}</h3><p>{product.copy}</p><small>{product.note}</small></article>)}</div>
    </section>
  );
}

function ManagedService() {
  const values = [
    ["Collaboration", "Shared roles, projects, review context, and revision-aware decisions."],
    ["Private media", "Organization-scoped storage and authorized access—not public asset links."],
    ["Deterministic rendering", "Validated outputs stay tied to the exact revision your team approved."],
    ["Bounded AI usage", "Managed AI and media processing are included within confirmed beta limits."],
    ["Human approval", "Automation proposes and accelerates; people decide what becomes a short."]
  ];
  return (
    <section className="managed-section" aria-labelledby="managed-title"><div><p className="eyebrow">What Cloud manages</p><h2 id="managed-title">The infrastructure fades back. Editorial control stays visible.</h2><p>Cloud and Mobile are paid managed products. Invited-beta pricing and exact limits are confirmed during onboarding; public dollar pricing is not yet published.</p></div><div className="managed-list">{values.map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></section>
  );
}

function BetaStatus() {
  return (
    <section className="status-section" id="beta-status" aria-labelledby="status-title"><div className="section-heading compact"><p className="eyebrow">Transparent by default</p><h2 id="status-title">What is available—and what is still being proven.</h2></div><div className="status-grid">
      <article><span className="status-pill available">Available in Desktop</span><h3>Local editorial foundations</h3><p>Local media inventory, transcript and candidate review, revision-safe short projects, composition, render validation, scheduling, and desktop workflows are implemented under the Desktop specification.</p></article>
      <article><span className="status-pill beta">Cloud private-beta work</span><h3>Managed workspace foundations</h3><p>Identity, tenancy, private storage, queueing, collaboration, managed processing, and rendering are active beta work. The complete upload-to-render journey has not yet passed staging acceptance.</p></article>
      <article><span className="status-pill roadmap">Mobile roadmap</span><h3>Capture and review companion</h3><p>Mobile is planned for capture, handoff, status, review, and approvals through the Cloud account—not timeline-heavy editing.</p></article>
    </div></section>
  );
}

type SubmitState = "idle" | "submitting" | "accepted" | "error";

function BetaAccessForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!turnstileSiteKey || document.querySelector('script[data-siftcut-turnstile]')) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.siftcutTurnstile = "true";
    document.head.append(script);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      setState("error");
      setMessage("Complete the required fields before submitting.");
      return;
    }
    const data = new FormData(event.currentTarget);
    const turnstileToken = String(data.get("cf-turnstile-response") ?? "");
    if (!turnstileToken) {
      setState("error"); setMessage("Complete the verification before submitting."); return;
    }
    setState("submitting"); setMessage("");
    const body = Object.fromEntries(["email", "name", "teamName", "teamSize", "contentType", "monthlyHours", "notes"].map((key) => [key, String(data.get(key) ?? "")]));
    try {
      const response = await fetch("/v1/beta-access-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, consent: data.get("consent") === "on", turnstileToken }) });
      if (!response.ok) throw new Error();
      setState("accepted"); setMessage("Thanks—your request is in. We manually review each early-beta team.");
      formRef.current?.reset();
    } catch {
      setState("error"); setMessage("We could not submit your request. Check the fields and try again.");
    }
  }

  return (
    <section className="beta-access-section" id="beta-access" aria-labelledby="beta-access-title"><div className="beta-access-copy"><p className="eyebrow">Request beta access</p><h2 id="beta-access-title">Tell us about the stories your team is shaping.</h2><p>Early access is manually reviewed for podcast, YouTube, and small-studio teams. We will confirm invited-beta pricing and included usage during onboarding.</p></div>
      {state === "accepted" ? <div className="form-success" role="status"><span>✓</span><h3>Request received.</h3><p>{message}</p></div> : <form ref={formRef} className="beta-form" onSubmit={submit} noValidate>
        <div className="field-row"><Field label="Your name" name="name" maxLength={120} autoComplete="name" /><Field label="Work email" name="email" type="email" maxLength={254} autoComplete="email" /></div>
        <Field label="Team or studio name (optional)" name="teamName" maxLength={160} autoComplete="organization" />
        <div className="field-row"><SelectField label="Team size" name="teamSize" options={[["", "Select"], ["solo", "Just me"], ["2-5", "2–5"], ["6-10", "6–10"], ["11-25", "11–25"], ["26+", "26+"]]} /><SelectField label="Primary content" name="contentType" options={[["", "Select"], ["podcast", "Podcast"], ["youtube", "YouTube"], ["studio", "Small studio / mixed"], ["other", "Other"]]} /></div>
        <SelectField label="Long-form hours per month" name="monthlyHours" options={[["", "Select"], ["under-10", "Under 10"], ["10-25", "10–25"], ["26-50", "26–50"], ["51-100", "51–100"], ["100+", "More than 100"]]} />
        <label className="form-field"><span>What would make the beta useful? (optional)</span><textarea name="notes" maxLength={1000} rows={4} /></label>
        <label className="consent"><input name="consent" type="checkbox" required /><span>I agree that SiftCut may use these details to review and respond to this beta request.</span></label>
        {turnstileSiteKey ? <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="dark" /> : <p className="form-config-note">Request verification is configured in staging and production.</p>}
        {message && <p className="form-message" role="alert">{message}</p>}
        <button className="primary form-submit" disabled={state === "submitting" || !turnstileSiteKey}>{state === "submitting" ? "Sending…" : "Request beta access"}</button>
        <p className="privacy-note">We use this information only to evaluate and contact you about beta access. We do not publish a requester list or add you to a marketing sequence. See our trust and privacy material for service subprocessors.</p>
      </form>}
    </section>
  );
}

function Field({ label, name, ...input }: { label: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="form-field"><span>{label}</span><input name={name} required {...input} /></label>;
}
function SelectField({ label, name, options }: { label: string; name: string; options: string[][] }) {
  return <label className="form-field"><span>{label}</span><select name={name} required>{options.map(([value, text]) => <option value={value} key={value || "blank"}>{text}</option>)}</select></label>;
}
