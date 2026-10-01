#!/usr/bin/env python3
"""Oráculo INDEPENDENTE da reconstrução de ciclos do NT8 (grade Trade Performance em PT-BR).

Uso:
    python3 scripts/oracle-nt8-cycles.py <export.csv> [--expected <export.expected.json>]

Independência: este script NÃO importa nem espelha o código TypeScript (reconstruct.ts). Ele usa só a regra de
negócio escrita em docs/ai-partner/nt8-position-reconstruction-spec.md:
  - cada linha do NT8 = lote de entrada casado com lote de saída (não é um trade);
  - ciclo = linhas com a mesma chave (conta + contrato + estratégia + direção) cujos intervalos [entrada, saída]
    se SOBREPÕEM estritamente (entrada < fim do ciclo); lacuna ou mesmo segundo separam;
  - P&L do ciclo = soma das linhas (bruto = líquido + corretagem + taxas); preços = médias ponderadas por quantidade.
Sem dados reais aqui dentro: o CSV é argumento e fica fora do repositório. Sem dependências além da stdlib.
Saída: resumo em JSON no stdout; com --expected, compara com o .expected.json e sai com código 1 se divergir.
"""
import csv
import datetime as dt
import io
import json
import sys

FEES = ("Taxa de Compensação", "Taxa de Bolsa", "Taxa de IP", "Taxa NFA")
EPS = 1e-6


def money(text: str) -> float:
    s = text.strip()
    neg = s.startswith("-") or (s.startswith("(") and s.endswith(")"))
    s = s.replace("-", "").replace("(", "").replace(")", "").replace("$", "").replace(" ", "").replace(" ", "")
    value = float(s.replace(".", "").replace(",", "."))
    return -value if neg else value


def number(text: str) -> float:
    return float(text.strip().replace(".", "").replace(",", "."))


def when(text: str) -> dt.datetime:
    return dt.datetime.strptime(text.strip(), "%d/%m/%Y %H:%M:%S")


def load(path: str) -> list:
    raw = open(path, encoding="utf-8-sig", newline="").read()
    rows = list(csv.reader(io.StringIO(raw), delimiter=";"))
    header = rows[0]
    ix = {h.replace("Sáída", "Saída"): i for i, h in enumerate(header)}
    out = []
    for n, r in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in r):
            continue
        out.append({
            "n": n,
            "key_acc": r[ix["Conta"]], "sym": r[ix["Ativo"]], "strat": r[ix["Estratégia"]],
            "long": "compra" in r[ix["Pos mercado."]].lower(),
            "q": int(number(r[ix["Qtd"]])),
            "pe": number(r[ix["Preço entrada"]]), "px": number(r[ix["Preço saída"]]),
            "start": when(r[ix["Hora entrada"]]), "end": when(r[ix["Hora saída"]]),
            "net": money(r[ix["Profit"]]), "cum": money(r[ix["Acu lucro líquido"]]),
            "com": money(r[ix["Corretagem"]]), "fee": round(sum(money(r[ix[k]]) for k in FEES if k in ix), 2),
        })
    return out


def cycles_of(lots: list) -> list:
    groups = {}
    for lot in lots:
        groups.setdefault((lot["key_acc"], lot["sym"], lot["strat"], lot["long"]), []).append(lot)
    cycles = []
    for chain in groups.values():
        chain.sort(key=lambda l: (l["start"], l["end"]))
        current = None
        for lot in chain:
            if current is not None and lot["start"] < current["end"]:  # sobreposição ESTRITA junta
                current["lots"].append(lot)
                current["end"] = max(current["end"], lot["end"])
            else:  # lacuna OU mesmo segundo separam
                if current is not None:
                    cycles.append(current)
                current = {"lots": [lot], "end": lot["end"]}
        cycles.append(current)
    return cycles


def summarize(cycle: dict) -> dict:
    lots = cycle["lots"]
    qty = sum(l["q"] for l in lots)
    net = round(sum(l["net"] for l in lots), 2)
    com = round(sum(l["com"] for l in lots), 2)
    fee = round(sum(l["fee"] for l in lots), 2)
    return {
        "rows": sorted(l["n"] for l in lots),
        "direction": "LONG" if lots[0]["long"] else "SHORT",
        "quantity": qty,
        "entryPrice": sum(l["q"] * l["pe"] for l in lots) / qty,
        "exitPrice": sum(l["q"] * l["px"] for l in lots) / qty,
        "net": net, "commission": com, "fees": fee, "gross": round(net + com + fee, 2),
    }


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    lots = load(args[0])
    cycles = sorted((summarize(c) for c in cycles_of(lots)), key=lambda c: c["rows"][0])
    running, cumulative_ok = 0.0, True
    for lot in lots:
        running = round(running + lot["net"], 2)
        cumulative_ok = cumulative_ok and abs(running - lot["cum"]) < EPS
    summary = {
        "rowsIn": len(lots), "cycles": len(cycles), "cumulativeConsistent": cumulative_ok,
        "netTotal": round(sum(l["net"] for l in lots), 2),
        "grossTotal": round(sum(c["gross"] for c in cycles), 2),
        "commissionTotal": round(sum(l["com"] for l in lots), 2),
        "feesTotal": round(sum(l["fee"] for l in lots), 2),
        "quantityTotal": sum(l["q"] for l in lots),
        "winners": sum(1 for c in cycles if c["net"] > 0), "losers": sum(1 for c in cycles if c["net"] < 0),
        "breakeven": sum(1 for c in cycles if c["net"] == 0),
    }
    print(json.dumps(summary, indent=2))
    if "--expected" not in args:
        return 0

    expected = json.load(open(args[args.index("--expected") + 1], encoding="utf-8"))
    problems = []
    for key in ("rowsIn", "cycles", "netTotal"):
        if key in expected and abs(expected[key] - summary[key]) > EPS:
            problems.append(f"{key}: esperado {expected[key]} · oráculo {summary[key]}")
    if "grossTotal" in expected and abs(expected["grossTotal"] - summary["grossTotal"]) > EPS:
        problems.append(f"grossTotal: esperado {expected['grossTotal']} · oráculo {summary['grossTotal']}")
    by_row = {row: c for c in cycles for row in c["rows"]}
    for e in expected.get("trades", []):
        c = by_row.get(e["row"])
        if c is None:
            problems.append(f"linha {e['row']} não pertence a nenhum ciclo do oráculo")
            continue
        for field in ("direction", "quantity", "net", "gross", "commission", "fees"):
            if field in e and (e[field] != c[field] if field == "direction" else abs(e[field] - c[field]) > EPS):
                problems.append(f"ciclo da linha {e['row']} · {field}: esperado {e[field]} · oráculo {c[field]}")
        for field in ("entryPrice", "exitPrice"):
            if field in e and abs(e[field] - c[field]) > 1e-6:
                problems.append(f"ciclo da linha {e['row']} · {field}: esperado {e[field]} · oráculo {c[field]}")
    if not summary["cumulativeConsistent"]:
        problems.append("o 'Acu lucro líquido' do NT8 não fecha linha a linha")
    if problems:
        print("DIVERGÊNCIAS:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    print(f"OK: {len(expected.get('trades', []))} ciclos conferidos contra o expected.json", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
