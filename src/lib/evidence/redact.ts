// Redação de privacidade da Evidence: troca o que carrega o NOME da conta pelo `accountRef`.
// Único lugar que sabe onde `account.sourceName` pode aparecer dentro de um CanonicalTrade (hoje: `account.sourceName`
// e `reconstruction.cycleKey.account`). Quem gerar TradeEvidence (E3) passa por aqui.

import type { CanonicalTrade } from "../domain/canonical.ts"
import { accountRef } from "../ingest/identity.ts"
import type { ReconstructionEvidence } from "./schema.ts"

/** `salt` precisa ser o mesmo usado no import (`accountRefSalt`), senão o ref não bate com `trade.account.ref`. */
export function redactReconstruction(rec: NonNullable<CanonicalTrade["reconstruction"]>, salt = ""): ReconstructionEvidence {
  const { account, ...key } = rec.cycleKey
  return { ...rec, cycleKey: { ...key, accountRef: accountRef(account, salt) } }
}
