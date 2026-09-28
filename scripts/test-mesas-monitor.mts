// Testes do monitor do Help Center (sem framework): node scripts/test-mesas-monitor.mts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ALVOS_MONITOR, ARTIGOS_LUCID, PAGINAS_FFF, diffLinhas, extrairTexto, hashTexto, tituloDoSlug, urlArtigo, urlPaginaFff, urlPermitida } from "../src/lib/mesas/monitor.ts"

let passed = 0
const test = (name: string, fn: () => void) => {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const HTML = `<html><head><title>x</title></head><body><nav>menu que NÃO conta</nav>
<article class="jsx-1 "><div class="intercom-interblocks-paragraph"><p>LucidFlex uses the simplest payout system.</p></div>
<div><h2 id="h1">Payout Requirements</h2></div>
<ul><li>Minimum payout: $500 &amp; up</li><li>5 days &gt;= $150</li></ul>
<table><tr><td>50K</td><td>$2,000</td></tr></table>
<script>var lixo = 1</script><p>Line&nbsp;with&nbsp;nbsp &#39;quote&#39;<br>after break</p></article>
<footer>rodapé que NÃO conta</footer></body></html>`

test("extrairTexto pega só o <article>, uma linha por bloco, sem tag/script/entidade", () => {
  const t = extrairTexto(HTML)!
  assert.ok(t.includes("LucidFlex uses the simplest payout system."))
  assert.ok(t.includes("Minimum payout: $500 & up"))
  assert.ok(t.includes("5 days >= $150"))
  assert.ok(t.includes("50K | $2,000 |"))
  assert.ok(t.includes("Line with nbsp 'quote'"))
  assert.ok(t.includes("after break"))
  assert.ok(!t.includes("menu que NÃO conta") && !t.includes("rodapé") && !t.includes("lixo") && !t.includes("<"))
})

test("sem <article>, cai pro <main> (FAQs da FFF) e ignora o resto da página", () => {
  const faq = `<html><header>Promo: 6 Days : 02 Hr : 19 Min : 44 Sec</header><main><div><h1>Is news trading allowed?</h1><p>Yes. At Funded Futures Family, you\u2019re allowed to trade major news events like FOMC, CPI, and NFP.</p></div></main><footer>rodapé</footer></html>`
  const t = extrairTexto(faq)!
  assert.ok(t.includes("Is news trading allowed?") && t.includes("FOMC"))
  assert.ok(!t.includes("Promo") && !t.includes("rodapé"))
})

test("página sem <article> ou com texto curto demais = null (erro de leitura, não 'mudou')", () => {
  assert.equal(extrairTexto("<html><body>Just a moment...</body></html>"), null)
  assert.equal(extrairTexto("<article><p>oi</p></article>"), null)
})

test("hash é estável e muda com qualquer alteração de regra", () => {
  const a = extrairTexto(HTML)!
  assert.equal(hashTexto(a), hashTexto(extrairTexto(HTML)!))
  assert.notEqual(hashTexto(a), hashTexto(a.replace("$500", "$600")))
})

test("diffLinhas mostra o que saiu e o que entrou", () => {
  const antes = "Minimum payout: $500\nMax: $2,000\nSame line"
  const depois = "Minimum payout: $600\nMax: $2,000\nSame line\nNew rule"
  const d = diffLinhas(antes, depois)
  assert.deepEqual(d.removidas, ["Minimum payout: $500"])
  assert.deepEqual(d.adicionadas, ["Minimum payout: $600", "New rule"])
  assert.deepEqual(diffLinhas(antes, antes), { removidas: [], adicionadas: [] })
})

test("urlPermitida (anti-SSRF): só https + host exato + caminho de artigo", () => {
  assert.equal(urlPermitida(urlArtigo("12945796-lucidflex-payouts")), true)
  const ruins = [
    "http://support.lucidtrading.com/en/articles/1-x",
    "https://support.lucidtrading.com.evil.com/en/articles/1-x",
    "https://evil.com/support.lucidtrading.com/en/articles/1-x",
    "https://support.lucidtrading.com@evil.com/en/articles/1-x",
    "https://user:pass@support.lucidtrading.com/en/articles/1-x",
    "https://support.lucidtrading.com:8443/en/articles/1-x",
    "https://lucidtrading.com/#plans",
    "https://169.254.169.254/latest/meta-data",
    "http://localhost:3000/api/user",
    "file:///etc/passwd",
    "não é url",
  ]
  for (const u of ruins) assert.equal(urlPermitida(u), false, u)
})

test("todo artigo monitorado passa no anti-SSRF, sem duplicata", () => {
  assert.equal(ARTIGOS_LUCID.length, 44)
  assert.equal(new Set(ARTIGOS_LUCID).size, ARTIGOS_LUCID.length)
  for (const s of ARTIGOS_LUCID) assert.match(s, /^\d+-[a-z0-9-]+$/, `slug inválido: ${s}`)
  for (const s of ARTIGOS_LUCID) assert.ok(urlPermitida(urlArtigo(s)), s)
})

test("todo artigo citado como fonte em lucid.ts está sendo monitorado", () => {
  const lucid = readFileSync(new URL("../src/lib/mesas/lucid.ts", import.meta.url), "utf8")
  const fontes = [...lucid.matchAll(/fonte\("([^"]+)"\)/g)].map((m) => m[1])
  assert.ok(fontes.length >= 20, `achou só ${fontes.length} fontes`)
  for (const f of fontes) assert.ok(ARTIGOS_LUCID.includes(f), `fonte de lucid.ts fora do monitor: ${f}`)
})

test("todo slug monitorado existe na lista oficial lida em 28/09", () => {
  const urls = readFileSync(new URL("../docs/mesas-proprietarias/fontes/lucid-helpcenter-urls.txt", import.meta.url), "utf8")
  for (const s of ARTIGOS_LUCID) assert.ok(urls.includes(`/${s}`), s)
})

test("tituloDoSlug", () => {
  assert.equal(tituloDoSlug("12945796-lucidflex-payouts"), "lucidflex payouts")
})

// ---------- Funded Futures Family ----------
test("FFF: 35 páginas, sem duplicata, todas na lista permitida", () => {
  assert.equal(PAGINAS_FFF.length, 35)
  assert.equal(new Set(PAGINAS_FFF).size, PAGINAS_FFF.length)
  for (const c of PAGINAS_FFF) {
    assert.match(c, /^(faq\/)?[a-z0-9-]+$/, `caminho inválido: ${c}`)
    assert.ok(urlPermitida(urlPaginaFff(c)), c)
  }
})

test("FFF: a lista do monitor é IGUAL ao arquivo de URLs do levantamento", () => {
  const arquivo = readFileSync(new URL("../docs/mesas-proprietarias/fontes/fff-urls.txt", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  assert.deepEqual(new Set(arquivo), new Set(PAGINAS_FFF.map(urlPaginaFff)))
})

test("FFF: toda fonte citada em fff.ts (fonte(...)) está sendo monitorada", () => {
  const fff = readFileSync(new URL("../src/lib/mesas/fff.ts", import.meta.url), "utf8")
  const fontes = [...fff.matchAll(/fonte\("([^"]+)"\)/g)].map((m) => m[1].replace(/\/$/, ""))
  assert.ok(fontes.length >= 10, `achou só ${fontes.length} fontes`)
  for (const f of fontes) assert.ok(PAGINAS_FFF.includes(f), `fonte de fff.ts fora do monitor: ${f}`)
})

test("FFF anti-SSRF: só a URL exata; quase-certas são recusadas (inclui ?ref_code)", () => {
  const ruins = [
    "https://www.fundedfuturesfamily.com/blog/",
    "https://www.fundedfuturesfamily.com/live-payouts/",
    "https://www.fundedfuturesfamily.com/prime-plan/?ref_code=abc",
    "https://www.fundedfuturesfamily.com/prime-plan",
    "http://www.fundedfuturesfamily.com/prime-plan/",
    "https://fundedfuturesfamily.com/prime-plan/",
    "https://www.fundedfuturesfamily.com.evil.com/prime-plan/",
    "https://www.fundedfuturesfamily.com@evil.com/prime-plan/",
    "https://evil.com/https://www.fundedfuturesfamily.com/prime-plan/",
  ]
  for (const u of ruins) assert.equal(urlPermitida(u), false, u)
})

test("monitor: alvos da Lucid e da FFF, com nomes de mesa únicos e itens não vazios", () => {
  assert.deepEqual(ALVOS_MONITOR.map((a) => a.mesa), ["lucid", "fff"])
  for (const a of ALVOS_MONITOR) assert.ok(a.itens.length > 0 && a.nome && a.rotulo, a.mesa)
})

test("tituloDoSlug entende FAQ da FFF", () => {
  assert.equal(tituloDoSlug("faq/is-news-trading-allowed"), "is news trading allowed")
  assert.equal(tituloDoSlug("prime-plan"), "prime plan")
})

console.log(`\n${passed} testes ok`)
