"use client"

import { useState } from "react"
import Image from "next/image"
import { Copy, Check, Trash2, Plus, ChevronDown, ChevronUp, Download, Clock, Terminal, FolderOpen, Zap, TrendingUp, Settings, FileText, Upload, AlertTriangle, CheckCircle2, ZoomIn } from "lucide-react"
import { cn } from "@/lib/utils"

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed: string | null
  createdAt: string
}

interface Props {
  initialKeys: ApiKey[]
}

// Plataformas disponíveis
const PLATFORMS = [
  { id: "ninjatrader", label: "NinjaTrader 8", short: "NT", active: true, description: "Sincronização automática de trades" },
  { id: "rithmic",     label: "Rithmic",        short: "R",  active: false, description: "Em breve — Q3 2026" },
  { id: "tradestation",label: "TradeStation",   short: "TS", active: false, description: "Em breve — Q4 2026" },
  { id: "ibkr",        label: "Interactive Brokers", short: "IB", active: false, description: "Em breve — 2027" },
]

export function IntegrationSection({ initialKeys }: Props) {
  const [platform, setPlatform]     = useState("ninjatrader")
  const [keys, setKeys]             = useState<ApiKey[]>(initialKeys)
  const [loading, setLoading]             = useState(false)
  const [downloading, setDownloading]     = useState(false)
  const [downloadingCfg, setDownloadingCfg] = useState(false)
  const [copied, setCopied]               = useState<string | null>(null)
  const [tutorialOpen, setTutorialOpen]   = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const res = await fetch("/api/integrations/apikeys", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { alert(data.error); return }
      setKeys((prev) => [data, ...prev])
      setTutorialOpen(true)
    } finally { setLoading(false) }
  }

  async function revoke(id: string) {
    if (!confirm("Revogar esta API Key? O NinjaTrader vai parar de sincronizar até você configurar uma nova.")) return
    await fetch(`/api/integrations/apikeys/${id}`, { method: "DELETE" })
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }

  function copyKey(key: string, id: string) {
    navigator.clipboard.writeText(key)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  async function downloadAddon() {
    setDownloading(true)
    try {
      const res = await fetch("/api/integrations/ninjatrader-addon/download")
      if (!res.ok) { alert("Erro ao gerar o arquivo. Tente novamente."); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = "TraderOSSync.zip"
      a.click()
      URL.revokeObjectURL(url)
      const keysRes = await fetch("/api/integrations/apikeys")
      if (keysRes.ok) setKeys(await keysRes.json())
      setTutorialOpen(true)
    } finally { setDownloading(false) }
  }

  async function downloadConfig() {
    setDownloadingCfg(true)
    try {
      const res = await fetch("/api/integrations/ninjatrader-addon/config")
      if (!res.ok) { alert("Erro ao gerar o arquivo. Tente novamente."); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = "traderos_config.txt"
      a.click()
      URL.revokeObjectURL(url)
    } finally { setDownloadingCfg(false) }
  }

  const lastSync = keys.find((k) => k.lastUsed)?.lastUsed
  const hasKeys  = keys.length > 0
  const selected = PLATFORMS.find((p) => p.id === platform)!

  return (
    <div className="space-y-5">

      {/* Seletor de plataformas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPlatform(p.id)}
            className={cn(
              "relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all",
              platform === p.id
                ? "border-teal bg-teal/5 text-foreground"
                : "border-border bg-muted/10 text-muted-foreground hover:border-border/80 hover:bg-muted/20",
              !p.active && "opacity-60"
            )}
          >
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold",
              platform === p.id ? "bg-teal text-teal-foreground" : "bg-muted text-muted-foreground"
            )}>
              {p.short}
            </div>
            <span className="text-[10px] font-medium leading-tight">{p.label}</span>
            {p.active ? (
              <span className="text-[9px] text-teal font-medium">● Disponível</span>
            ) : (
              <span className="text-[9px] text-muted-foreground">Em breve</span>
            )}
          </button>
        ))}
      </div>

      {/* Conteúdo por plataforma */}
      {platform === "ninjatrader" ? (
        <div className="space-y-4">

          {/* Status + ação */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {hasKeys && lastSync ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-profit animate-pulse" />
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Último sync: {new Date(lastSync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </>
              ) : hasKeys ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-teal" />
                  <span className="text-xs text-teal">Pronto para sincronizar</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Não configurado</span>
                </>
              )}
            </div>
            {keys.length < 3 && (
              <button
                onClick={generate}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teal text-teal-foreground rounded-lg text-xs font-medium hover:bg-teal/90 transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {loading ? "Gerando..." : "Gerar API Key"}
              </button>
            )}
          </div>

          {/* Lista de keys */}
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border">
              <code className="flex-1 text-xs font-mono text-foreground truncate">
                {k.key.slice(0, 24)}••••••••••••••••
              </code>
              <button onClick={() => copyKey(k.key, k.id)} title="Copiar chave completa"
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0">
                {copied === k.id ? <Check className="w-3.5 h-3.5 text-profit" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => revoke(k.id)} title="Revogar chave"
                className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {keys.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              Gere uma API Key para começar a sincronizar seus trades automaticamente.
            </p>
          )}

          {/* Botões de download */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={downloadConfig}
                disabled={downloadingCfg}
                className="flex items-center justify-center gap-2 px-3 py-3 bg-muted/40 border border-border text-foreground rounded-xl text-xs font-semibold hover:bg-muted/60 transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-teal" />
                {downloadingCfg ? "Gerando..." : "1. Baixar Config"}
              </button>
              <button
                onClick={downloadAddon}
                disabled={downloading}
                className="flex items-center justify-center gap-2 px-3 py-3 bg-teal text-teal-foreground rounded-xl text-xs font-semibold hover:bg-teal/90 transition-colors disabled:opacity-50 shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                {downloading ? "Gerando..." : "2. Baixar AddOn (.zip)"}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Baixe os 2 arquivos → siga o tutorial abaixo → pronto em ~3 minutos
            </p>
          </div>

          {/* Tutorial passo a passo */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setTutorialOpen(!tutorialOpen)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-sm font-medium text-foreground"
            >
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-teal" />
                Como instalar — Tutorial passo a passo
              </span>
              {tutorialOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {tutorialOpen && (
              <div className="divide-y divide-border">

                {/* Aviso de tempo */}
                <div className="px-5 py-3 bg-teal/5 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-teal shrink-0" />
                  <p className="text-[11px] text-muted-foreground">
                    Configuração única de <strong className="text-foreground">~3 minutos</strong>. Depois é automático para sempre. Siga os passos na ordem.
                  </p>
                </div>

                {/* Passo 1 */}
                <TutorialStep n={1} title="Acesse Configurações no TraderOS" icon={<Settings className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    No menu lateral esquerdo, clique em <strong className="text-foreground">Configurações</strong> (no rodapé) e role até a seção <strong className="text-foreground">Integrações → NinjaTrader 8</strong>.
                  </p>
                  <TutorialImage src="/tutorial/step1-dashboard.png" alt="Dashboard do TraderOS" caption="O botão Configurações fica no canto inferior esquerdo" />
                </TutorialStep>

                {/* Passo 2 */}
                <TutorialStep n={2} title="Baixe os 2 arquivos" icon={<Download className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Clique em <strong className="text-foreground">1. Baixar Config</strong> e depois em <strong className="text-foreground">2. Baixar AddOn (.zip)</strong>. Você vai receber dois arquivos:
                  </p>
                  <div className="space-y-2 mb-3">
                    <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg border border-border">
                      <FileText className="w-4 h-4 text-teal shrink-0" />
                      <span className="text-teal font-mono text-[11px]">traderos_config.txt</span>
                      <span className="text-muted-foreground text-[10px]">→ sua API Key (gerada automaticamente)</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg border border-border">
                      <Download className="w-4 h-4 text-teal shrink-0" />
                      <span className="text-teal font-mono text-[11px]">TraderOSSync.zip</span>
                      <span className="text-muted-foreground text-[10px]">→ o AddOn do NinjaTrader</span>
                    </div>
                  </div>
                  <TutorialImage src="/tutorial/step2-configuracoes-integracoes.png" alt="Botões de download do AddOn" caption="Os dois botões de download na seção NinjaTrader 8" />
                </TutorialStep>

                {/* Passo 3 */}
                <TutorialStep n={3} title="Abra a pasta do NinjaTrader" icon={<FolderOpen className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    No Windows, pressione <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono text-foreground">Win + R</kbd>, cole o caminho abaixo e pressione <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono text-foreground">Enter</kbd>:
                  </p>
                  <div className="p-3 bg-[#0a0f1a] rounded-lg border border-border mb-3">
                    <code className="text-[11px] font-mono text-teal break-all">
                      %USERPROFILE%\Documents\NinjaTrader 8
                    </code>
                  </div>
                  <TutorialImage src="/tutorial/step3-winr-correto.png" alt="Janela Executar com o caminho" caption="Cole o caminho exatamente como está acima" />
                </TutorialStep>

                {/* Passo 4 */}
                <TutorialStep n={4} title="Coloque o config dentro dessa pasta" icon={<FileText className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Mova o arquivo <span className="font-mono text-[10px] text-teal">traderos_config.txt</span> (que você baixou no passo 2) para dentro da pasta <span className="font-mono text-[10px]">NinjaTrader 8</span> que acabou de abrir — direto na raiz, <strong className="text-foreground">não em subpastas</strong>.
                  </p>
                  <TutorialImage src="/tutorial/step5-traderos-config-na-pasta.png" alt="Arquivo de config na pasta do NinjaTrader" caption="O traderos_config.txt deve ficar na raiz da pasta NinjaTrader 8" />
                </TutorialStep>

                {/* Passo 5 */}
                <TutorialStep n={5} title="Importe o AddOn no NinjaTrader" icon={<Upload className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Abra o NinjaTrader 8. No menu superior, vá em:
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap p-3 bg-muted/20 rounded-lg border border-border mb-3">
                    <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">Ferramentas</kbd>
                    <span className="text-muted-foreground text-xs">→</span>
                    <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">Importar</kbd>
                    <span className="text-muted-foreground text-xs">→</span>
                    <kbd className="bg-teal/10 border border-teal/30 text-teal px-2 py-1 rounded text-[10px] font-mono">Complemento de NinjaScript</kbd>
                  </div>
                  <TutorialImage src="/tutorial/step20-ferramentas-importar-novo.png" alt="Menu Ferramentas → Importar" caption="Ferramentas → Importar → Complemento de NinjaScript" />
                </TutorialStep>

                {/* Passo 6 */}
                <TutorialStep n={6} title="Selecione o arquivo TraderOSSync.zip" icon={<FolderOpen className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Na janela que abrir, navegue até a pasta <strong className="text-foreground">Downloads</strong>, selecione o arquivo{" "}
                    <span className="font-mono text-[10px] text-teal">TraderOSSync.zip</span> e clique em <strong className="text-foreground">Abrir</strong>.
                  </p>
                  <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg mb-3">
                    <p className="text-[10px] text-amber-500/90">Não descompacte o arquivo — selecione o .zip do jeito que está.</p>
                  </div>
                  <TutorialImage src="/tutorial/step21-selecionar-zip-importar.png" alt="Seletor de arquivo com o zip" caption="Selecione o TraderOSSync.zip e clique em Abrir" />
                </TutorialStep>

                {/* Passo 7 */}
                <TutorialStep n={7} title="Confirme o aviso (é normal)" icon={<AlertTriangle className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Pode aparecer um aviso de <em>&ldquo;versão incompatível&rdquo;</em>. Isso é <strong className="text-foreground">normal</strong> e não afeta o funcionamento — apenas clique em <strong className="text-foreground">OK</strong> para continuar.
                  </p>
                  <TutorialImage src="/tutorial/step22-aviso-versao-normal.png" alt="Aviso de versão do NinjaTrader" caption="Clique em OK — o aviso pode ser ignorado com segurança" />
                </TutorialStep>

                {/* Passo 8 */}
                <TutorialStep n={8} title="Compile o AddOn (F5)" icon={<Terminal className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Agora abra o editor para ativar o AddOn:
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap p-3 bg-muted/20 rounded-lg border border-border mb-3">
                    <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">Novo</kbd>
                    <span className="text-muted-foreground text-xs">→</span>
                    <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">Editor NinjaScript</kbd>
                    <span className="text-muted-foreground text-xs">→</span>
                    <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">AddOns</kbd>
                    <span className="text-muted-foreground text-xs">→</span>
                    <kbd className="bg-teal/10 border border-teal/30 text-teal px-2 py-1 rounded text-[10px] font-mono">TraderOSSync</kbd>
                    <span className="text-muted-foreground text-xs">→ duplo clique →</span>
                    <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono font-bold">F5</kbd>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed mb-3">
                    No painel direito, abra a pasta <span className="font-mono text-[10px]">AddOns</span>, dê duplo clique em <span className="font-mono text-[10px]">TraderOSSync</span> e pressione <kbd className="bg-muted px-1 rounded font-mono text-[10px]">F5</kbd>. Um som confirma a compilação — e <strong className="text-foreground">nenhuma mensagem de erro vermelha</strong> aparece embaixo.
                  </p>
                  <TutorialImage src="/tutorial/step11-editor-com-traderos.png" alt="Editor NinjaScript com TraderOSSync" caption="TraderOSSync aparece dentro da pasta AddOns no painel direito" />
                  <TutorialImage src="/tutorial/step12-compilado-sucesso.png" alt="Código compilado sem erros" caption="Após o F5: código aberto e sem erros = compilado com sucesso" />
                </TutorialStep>

                {/* Passo 9 */}
                <TutorialStep n={9} title="Confirme que o AddOn está ativo" icon={<CheckCircle2 className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Abra a janela de saída para conferir:
                    <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono mx-1">Novo</kbd>→
                    <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono mx-1">Saída NinjaScript</kbd>.
                    Deve aparecer:
                  </p>
                  <div className="p-4 bg-[#0a0f1a] rounded-xl border border-border font-mono text-[11px] space-y-1 mb-3">
                    <p className="text-green-400">[TraderOS] Config carregada. Pronto para sincronizar.</p>
                    <p className="text-green-400">[TraderOS] Ativo. Monitorando 4 conta(s). Aguardando execucoes.</p>
                  </div>
                  <TutorialImage src="/tutorial/step23-saida-ativo.png" alt="Saída NinjaScript com TraderOS ativo" caption="Se aparecer 'Ativo. Monitorando', a integração está pronta" />
                </TutorialStep>

                {/* Passo 10 */}
                <TutorialStep n={10} title="Pronto! Trades sincronizados automaticamente" icon={<TrendingUp className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    A partir de agora, cada trade fechado no NinjaTrader aparece <strong className="text-foreground">automaticamente</strong> no Journal do TraderOS em poucos segundos. Sem copiar dados, sem importar CSV — tudo em tempo real.
                  </p>
                  <TutorialImage src="/tutorial/step24-trade-ninjatrader.png" alt="Trade executado no NinjaTrader" caption="Você opera normalmente no NinjaTrader…" />
                  <TutorialImage src="/tutorial/step25-trade-traderos-journal.png" alt="Trade no Journal do TraderOS" caption="…e o trade aparece sozinho no Journal do TraderOS" />
                  <div className="mt-3 p-3 bg-profit/5 border border-profit/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-0.5">Configura uma vez, funciona para sempre.</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      O AddOn liga sozinho toda vez que o NinjaTrader abre — sem precisar de gráfico aberto nem de nenhuma configuração adicional. Funciona com todas as contas Apex (Eval e PA).
                    </p>
                  </div>
                </TutorialStep>

                {/* FAQ */}
                <div className="px-5 py-4 space-y-2">
                  <p className="text-xs font-semibold text-foreground mb-3">Dúvidas frequentes</p>
                  <Faq q="Preciso deixar algum gráfico aberto?">
                    Não. O AddOn roda em segundo plano assim que o NinjaTrader abre. Pode fechar todos os gráficos.
                  </Faq>
                  <Faq q="Funciona com conta Apex?">
                    Sim! A Apex usa o NinjaTrader. O AddOn captura trades de todas as contas conectadas (Eval e PA).
                  </Faq>
                  <Faq q="Trades antigos vão duplicar?">
                    Não. Cada trade tem um ID único. Se já foi enviado, o TraderOS ignora automaticamente.
                  </Faq>
                  <Faq q="O aviso de 'versão incompatível' é problema?">
                    Não. É só um aviso do NinjaTrader sobre a versão de exportação. Clique OK e siga normalmente — a integração funciona perfeitamente.
                  </Faq>
                  <Faq q="Por que preciso pressionar F5?">
                    O NinjaTrader importa o arquivo, mas só ativa o AddOn após compilar uma vez. É rápido: duplo clique no TraderOSSync e F5. Depois disso, ele liga sozinho toda vez que o NinjaTrader abre.
                  </Faq>
                  <Faq q="Posso revogar a API Key?">
                    Sim. Clique no ícone de lixeira. O sync para imediatamente. Para reconectar, baixe um novo traderos_config.txt e substitua o antigo na pasta do NinjaTrader.
                  </Faq>
                  <Faq q="O AddOn afeta minha performance de trading?">
                    Não. O envio é assíncrono e nunca bloqueia a thread de ordens do NinjaTrader.
                  </Faq>
                </div>

              </div>
            )}
          </div>

        </div>
      ) : (
        /* Plataforma em breve */
        <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-muted/30 border border-border flex items-center justify-center text-xl font-bold text-muted-foreground">
            {selected.short}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{selected.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>
          </div>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Estamos trabalhando na integração com {selected.label}. Deixe seu email para ser notificado quando estiver disponível.
          </p>
          <button className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
            Me avisar quando estiver disponível
          </button>
        </div>
      )}

    </div>
  )
}

function TutorialImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="mt-3">
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block rounded-xl overflow-hidden border border-border bg-[#0a0f1a]"
      >
        <Image
          src={src}
          alt={alt}
          width={1200}
          height={680}
          className="w-full h-auto"
        />
        {/* Badge "ampliar" — ajuda principalmente no celular, onde a imagem fica pequena */}
        <span className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-white text-[10px] font-medium">
          <ZoomIn className="w-3 h-3" />
          Ampliar
        </span>
      </a>
      <figcaption className="text-[10px] text-muted-foreground mt-1.5 text-center">
        {caption && <span className="italic">{caption}</span>}
        <span className="block sm:hidden text-teal/80 mt-0.5">Toque na imagem para ver em tela cheia</span>
      </figcaption>
    </figure>
  )
}

function TutorialStep({ n, title, icon, children }: { n: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-5 py-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-teal/10 border border-teal/30 flex items-center justify-center text-teal text-sm font-bold shrink-0">
          {n}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-teal">{icon}</span>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
      </div>
      <div className="ml-11">
        {children}
      </div>
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-xs text-foreground font-medium">{q}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1">
          <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
        </div>
      )}
    </div>
  )
}
