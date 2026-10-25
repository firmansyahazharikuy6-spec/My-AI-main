import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodePreviewDocument,
  buildLiveArtifactDocument,
  codeFileExtension,
  codeLanguageLabel,
  supportsCodePreview,
} from "./code-artifacts.js";

test("code artifacts expose readable labels and safe download extensions", () => {
  assert.equal(codeLanguageLabel("js"), "JavaScript");
  assert.equal(codeLanguageLabel(""), "Plaintext");
  assert.equal(codeFileExtension("tsx"), "tsx");
  assert.equal(codeFileExtension("unknown"), "txt");
  assert.equal(codeLanguageLabel("mermaid"), "Mermaid");
  assert.equal(codeFileExtension("mermaid"), "mmd");
});

test("live preview is enabled only for supported web languages and SVG XML", () => {
  assert.equal(supportsCodePreview("html"), true);
  assert.equal(supportsCodePreview("css"), true);
  assert.equal(supportsCodePreview("javascript"), true);
  assert.equal(supportsCodePreview("xml", "<svg viewBox='0 0 1 1'></svg>"), true);
  assert.equal(supportsCodePreview("xml", "<root/>"), false);
  assert.equal(supportsCodePreview("mermaid", "flowchart TD\n  A --> B"), true);
  assert.equal(supportsCodePreview("python"), false);
});

test("Mermaid preview escapes diagram text and uses strict sandbox-compatible rendering", () => {
  const document = buildCodePreviewDocument("flowchart TD\nA[<script>alert(1)</script>] --> B", "mermaid");
  assert.match(document, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(document, /<script>alert\(1\)<\/script>/);
  assert.match(document, /mermaid@11\/dist\/mermaid\.min\.js/);
  assert.match(document, /securityLevel:"strict"/);
  assert.match(document, /connect-src 'none'/);
});

test("preview documents sandbox network access and safely embed script/style snippets", () => {
  const html = buildCodePreviewDocument("<!doctype html><html><head></head><body><h1>Hello</h1></body></html>", "html");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /katex@0\.16\.8\/dist\/katex\.min\.css/);
  assert.match(html, /renderMathInElement\(document\.body/);
  assert.match(html, /left:"\$\$",right:"\$\$",display:true/);
  assert.match(html, /background-color:#0f1015/);
  assert.match(html, /<h1>Hello<\/h1>/);

  const css = buildCodePreviewDocument("h1 { color: red; }</style><script>alert(1)</script>", "css");
  assert.match(css, /Pratinjau CSS/);
  assert.match(css, /<\\\/style>/i);
  assert.ok(css.lastIndexOf("<style>") > css.indexOf("Pratinjau CSS"));
  assert.doesNotMatch(css, /<style>h1 \{ color: red; \}<\/style><script>/i);

  const javascript = buildCodePreviewDocument("document.body.textContent = '</script><script>alert(1)</script>'; ", "js");
  assert.match(javascript, /<\\\/script>/i);
  assert.match(javascript, /connect-src 'none'/);
});

test("unsupported code preview language is rejected", () => {
  assert.throws(() => buildCodePreviewDocument("print('hello')", "python"), /tidak mendukung pratinjau/);
});

test("live artifact combines HTML, CSS, and JavaScript inside the sandbox document", () => {
  const document = buildLiveArtifactDocument([
    { lang: "html", source: "<!doctype html><html><head></head><body><h1>Live</h1></body></html>" },
    { lang: "css", source: "h1 { color: red; }</style><script>alert(1)</script>" },
    { lang: "js", source: "document.body.dataset.ready = 'yes';</script><script>alert(1)</script>" },
  ]);
  assert.match(document, /Content-Security-Policy/);
  assert.match(document, /<h1>Live<\/h1>/);
  assert.match(document, /h1 \{ color: red; \}/);
  assert.match(document, /document\.body\.dataset\.ready/);
  assert.match(document, /<\\\/style>/i);
  assert.match(document, /<\\\/script>/i);
  assert.match(document, /katex@0\.16\.8\/dist\/katex\.min\.css/);
  assert.match(document, /katex@0\.16\.8\/dist\/contrib\/auto-render\.min\.js/);
  assert.match(document, /renderMathInElement\(document\.body/);
  assert.match(document, /background-color:#0f1015/);
  assert.match(document, /script-src 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/);
});

test("live artifact renders Mermaid diagrams alongside HTML", () => {
  const document = buildLiveArtifactDocument([
    { lang: "html", source: "<html><head></head><body><h1>Diagram</h1></body></html>" },
    { lang: "mermaid", source: "flowchart TD\nA[Start] --> B[End]" },
  ]);
  assert.match(document, /<h1>Diagram<\/h1>/);
  assert.match(document, /<pre class="mermaid">flowchart TD\nA\[Start\] --&gt; B\[End\]<\/pre>/);
  assert.match(document, /mermaid@11\/dist\/mermaid\.min\.js/);
  assert.match(document, /securityLevel:"strict"/);
});

test("Markdown artifacts render as escaped text without executing embedded HTML", () => {
  const document = buildLiveArtifactDocument([{ lang: "markdown", source: "# Notes\n<script>alert(1)</script>" }]);
  assert.match(document, /# Notes/);
  assert.match(document, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(document, /<script>alert\(1\)<\/script>/);
  assert.match(document, /Content-Security-Policy/);
});

test("live artifact preserves a defined background instead of applying dark defaults", () => {
  const document = buildLiveArtifactDocument([
    { lang: "html", source: "<html><head><style>body { background: white; }</style></head><body>Hi</body></html>" },
  ]);
  assert.match(document, /background: white/);
  assert.doesNotMatch(document, /background-color:#0f1015/);
});

test("live artifact adds a dark page background when only a child card has a background", () => {
  const document = buildLiveArtifactDocument([
    { lang: "html", source: "<html><head></head><body><main class=\"card\">Hi</main></body></html>" },
    { lang: "css", source: ".card { background: white; }" },
  ]);
  assert.match(document, /background-color:#0f1015/);
});

test("live artifact rejects unsupported or empty code blocks", () => {
  assert.throws(() => buildLiveArtifactDocument([]), /Tidak ada kode web/);
  assert.throws(() => buildLiveArtifactDocument([{ lang: "python", source: "print(1)" }]), /bahasa kode yang tidak didukung/);
});
