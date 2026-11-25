# Estratégia e Relatório de Testes — Rota Express 3.0

## Como Executar

```bash
npm test             # Executa todos os testes automatizados (Vitest)
npm run lint         # Verifica tipagem TypeScript (tsc --noEmit)
npm run lint:rules   # Audita firestore.rules com @firebase/eslint-plugin-security-rules
npm run build        # Valida empacotamento de produção + geração do Service Worker PWA
```

## Cobertura Automatizada

### 1. Motor de Domínio (`src/domain/__tests__/domain.test.ts`)
- **Endereços Brasileiros & Coordenadas**:
  - Preservação de zeros à esquerda em CEPs (`01001000` -> `01001-000`).
  - Normalização de abreviações brasileiras (`R.`, `Av.`, `Qd.`, `Lt.`, `St.`).
  - Garantia de que números ausentes nunca são inventados automaticamente.
  - Detecção e correção de latitude/longitude invertidas no Brasil e rejeição de `(0, 0)`.
  - Deduplicação determinística de endereços equivalentes e classificação estrita de confiança.
- **Planilhas & Segurança contra Formula Injection**:
  - Escape de payloads `=HYPERLINK(...)` e `+cmd|...` na exportação preservando coordenadas negativas (`-16.6869`).
  - Mapeamento determinístico de cabeçalhos logísticos brasileiros.
  - Preservação de zeros à esquerda em códigos de rastreio (`000987654321`), contagem de duplicados e linhas vazias sem perda silenciosa de pacotes.
- **Agrupamento & Status de Paradas**:
  - Conservação de 100% dos pacotes ao agrupar, desagrupar (`splitStop`) e mesclar (`mergeStops`).
  - Derivação correta de status `partial` quando apenas parte dos pacotes da parada foi entregue.
- **Otimizador Combinatório & 2ª Tentativa**:
  - Redução comprovada de distância frente à sequência embaralhada original em base de 50 pacotes.
  - Respeito rigoroso a paradas fixas de início e fim (`fixedFirstStopId`, `fixedLastStopId`).
  - Suporte a matrizes assimétricas (`dist(A→B) != dist(B→A)`).
  - Cálculo de desvio para 2ª tentativa e geração de links oficiais Google Maps, Waze e WhatsApp.
- **Financeiro Operacional**:
  - Proteção contra divisão por zero (`safeDivide`).
  - Prevenção de dupla contagem de combustível quando há abastecimento real lançado.

### 2. Auditoria Estrutural de Regras de Segurança (`firestore.rules.test.ts`)
- Verifica os 12 vetores críticos ("Dirty Dozen"): negação padrão, verificação de e-mail, isolamento por titular, bloqueio de auto-escalação de papel, imutabilidade de `delivery_events` e `api_usage`, bloqueio de mutação em rotas finalizadas e rejeição de strings JSON soltas.
